//! The books agents keep on this machine, in `~/.isbell`: their messages to the user, their roles,
//! and the user's goals and tasks. Agents write them through `isbell message|role|goal|task`;
//! readers only read them.
//!
//! A command reads a book whole, changes it with a pure function, checks the result and replaces
//! the file, all under one lock, so that agents writing at once never lose each other's changes. A
//! reader needs no lock: a book is replaced by a rename, so it reads the old file or the new one.

pub mod caller;
pub mod goals;
pub mod live;
pub mod messages;
pub mod project;
pub mod roles;

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rustix::fs::{FlockOperation, flock};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::env_path;

/// How long a command waits for another to finish with the books before it gives up.
const LOCK_WAIT: Duration = Duration::from_secs(5);
const LOCK_RETRY: Duration = Duration::from_millis(20);

/// One of the books: its file, an empty book for before the file is there, and what must hold.
pub trait Book: Serialize + DeserializeOwned + Default {
    const FILE: &'static str;
    fn check(&self) -> Result<(), BookError>;
}

#[derive(Debug, PartialEq, Eq)]
pub struct BookError {
    pub code: &'static str,
    pub message: String,
}

impl BookError {
    /// A change the book's rules refuse, or input that does not hold their forms.
    pub fn invalid(message: impl Into<String>) -> Self {
        Self { code: "invalid", message: message.into() }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self { code: "not_found", message: message.into() }
    }

    fn io(path: &Path, err: std::io::Error) -> Self {
        Self { code: "io", message: format!("{}: {err}", path.display()) }
    }
}

/// The file format's version: a book of another one is refused, not guessed at.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Version;

impl TryFrom<u8> for Version {
    type Error = String;
    fn try_from(v: u8) -> Result<Self, String> {
        if v == 1 { Ok(Version) } else { Err(format!("version {v} is not one isbell knows")) }
    }
}

impl From<Version> for u8 {
    fn from(_: Version) -> u8 {
        1
    }
}

/// The directory of the books.
pub struct Books {
    dir: PathBuf,
}

impl Books {
    /// `~/.isbell`, where the books of this machine are.
    pub fn home() -> Result<Self, BookError> {
        env_path("HOME")
            .map(|home| Self::at(home.join(".isbell")))
            .ok_or_else(|| BookError::invalid("HOME is not set"))
    }

    pub fn at(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// The book as it is; empty before its file is there.
    pub fn read<B: Book>(&self) -> Result<B, BookError> {
        let path = self.dir.join(B::FILE);
        let data = match fs::read(&path) {
            Ok(data) => data,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(B::default()),
            Err(err) => return Err(BookError::io(&path, err)),
        };
        let unreadable = |message: String| BookError {
            code: "unreadable",
            message: format!("{}: {message}", path.display()),
        };
        let book: B = serde_json::from_slice(&data).map_err(|err| unreadable(err.to_string()))?;
        book.check().map_err(|err| unreadable(err.message))?;
        Ok(book)
    }

    /// Changes the book: `change` gets it as it is and gives it back changed, with what to answer.
    /// The book is written only when the change is accepted and the result holds; other books
    /// read inside `change` are read under the same lock.
    pub fn change<B: Book, R>(
        &self,
        change: impl FnOnce(&Self, B) -> Result<(B, R), BookError>,
    ) -> Result<R, BookError> {
        let _lock = self.lock(LOCK_WAIT)?;
        let (next, answer) = change(self, self.read::<B>()?)?;
        next.check()?;
        self.write(B::FILE, &next)?;
        Ok(answer)
    }

    /// The lock every change takes; it is let go when dropped, or by the kernel when the process
    /// ends, so a command that dies never leaves the books locked.
    fn lock(&self, wait: Duration) -> Result<File, BookError> {
        self.ensure_dir()?;
        let path = self.dir.join(".book.lock");
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|err| BookError::io(&path, err))?;
        let deadline = Instant::now() + wait;
        loop {
            match flock(&file, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => return Ok(file),
                Err(rustix::io::Errno::WOULDBLOCK) if Instant::now() < deadline => {
                    std::thread::sleep(LOCK_RETRY)
                }
                Err(rustix::io::Errno::WOULDBLOCK) => {
                    return Err(BookError {
                        code: "book_busy",
                        message: format!(
                            "another command held {} for {}s: try again",
                            path.display(),
                            wait.as_secs()
                        ),
                    });
                }
                Err(err) => return Err(BookError::io(&path, err.into())),
            }
        }
    }

    /// Replaces the file whole: a reader sees the old one or the new one, never a part.
    fn write(&self, file: &str, book: &impl Serialize) -> Result<(), BookError> {
        let path = self.dir.join(file);
        let tmp = self.dir.join(format!(".{file}.{}", std::process::id()));
        let data = serde_json::to_vec_pretty(book).expect("books serialize");
        let written = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)
            .and_then(|mut f| f.write_all(&data).and_then(|()| f.sync_all()))
            .and_then(|()| fs::rename(&tmp, &path));
        written.map_err(|err| {
            match fs::remove_file(&tmp) {
                Err(left) if left.kind() != ErrorKind::NotFound => {
                    tracing::warn!(%left, path = %tmp.display(), "cannot remove a book's temporary file")
                }
                _ => {}
            }
            BookError::io(&path, err)
        })
    }

    fn ensure_dir(&self) -> Result<(), BookError> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.dir)
            .map_err(|err| BookError::io(&self.dir, err))
    }
}

/// One line of 1 to `limit` bytes, not blank.
pub fn is_line(s: &str, limit: usize) -> bool {
    !s.trim().is_empty() && !s.contains(['\r', '\n']) && s.len() <= limit
}

/// What a link names: `file:<absolute path>` or `project:<absolute path>`, the root of a project;
/// for messages also `session:<agent>:<id>`.
pub fn check_link(link: &str, session: bool) -> Result<(), BookError> {
    let absolute = |p: &str| Path::new(p).is_absolute();
    let ok = match link.split_once(':') {
        Some(("file" | "project", path)) => absolute(path),
        Some(("session", rest)) if session => rest
            .split_once(':')
            .is_some_and(|(agent, id)| caller::Agent::parse(agent).is_some() && !id.is_empty()),
        _ => false,
    };
    if ok {
        Ok(())
    } else if session {
        Err(BookError::invalid(format!(
            "link {link:?} is none of session:<agent>:<id>, file:<absolute path> or project:<absolute path>"
        )))
    } else {
        Err(BookError::invalid(format!(
            "link {link:?} is neither file:<absolute path> nor project:<absolute path>"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Default, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Tally {
        version: Version,
        items: Vec<u32>,
    }

    impl Book for Tally {
        const FILE: &'static str = "tally.json";
        fn check(&self) -> Result<(), BookError> {
            if self.items.contains(&0) { Err(BookError::invalid("no zeros")) } else { Ok(()) }
        }
    }

    fn add(books: &Books, n: u32) -> Result<(), BookError> {
        books.change(|_, mut t: Tally| {
            t.items.push(n);
            Ok((t, ()))
        })
    }

    #[test]
    fn a_change_replaces_the_book_and_one_that_breaks_it_is_not_written() {
        let dir = tempfile::tempdir().unwrap();
        let books = Books::at(dir.path().to_path_buf());
        add(&books, 1).unwrap();
        assert_eq!(add(&books, 0).unwrap_err().code, "invalid");
        assert_eq!(books.read::<Tally>().unwrap().items, [1]);
    }

    #[test]
    fn a_book_that_cannot_be_read_is_left_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let books = Books::at(dir.path().to_path_buf());
        fs::write(dir.path().join("tally.json"), r#"{"version":2,"items":[]}"#).unwrap();
        assert_eq!(add(&books, 1).unwrap_err().code, "unreadable");
        let kept = fs::read_to_string(dir.path().join("tally.json")).unwrap();
        assert_eq!(kept, r#"{"version":2,"items":[]}"#);
    }

    #[test]
    fn changes_at_once_all_stay() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let writers: Vec<_> = (1..=8)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || add(&Books::at(path), n))
            })
            .collect();
        writers.into_iter().for_each(|w| w.join().unwrap().unwrap());
        let mut items = Books::at(path).read::<Tally>().unwrap().items;
        items.sort();
        assert_eq!(items, (1..=8).collect::<Vec<_>>());
    }

    #[test]
    fn a_lock_held_too_long_is_busy() {
        let dir = tempfile::tempdir().unwrap();
        let books = Books::at(dir.path().to_path_buf());
        let _held = books.lock(LOCK_WAIT).unwrap();
        // flock locks belong to the open file, so a second open in this process waits too.
        let err = books.lock(Duration::from_millis(100)).unwrap_err();
        assert_eq!(err.code, "book_busy");
    }

    #[test]
    fn links_name_sessions_only_where_asked() {
        assert!(check_link("file:/a/b.md", false).is_ok());
        assert!(check_link("project:/a", false).is_ok());
        assert!(check_link("file:b.md", false).is_err());
        assert!(check_link("session:claude:1f2e", false).is_err());
        assert!(check_link("session:claude:1f2e", true).is_ok());
        assert!(check_link("session:emacs:1f2e", true).is_err());
    }
}
