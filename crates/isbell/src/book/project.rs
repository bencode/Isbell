//! The project a directory is in, as the agent hook tells it (`root_of` in agent-hook.sh): the
//! deepest repository holding it, a worktree's being the one it was added from, else the directory.

use std::path::{Path, PathBuf};

/// Directories too broad to be a project: `/`, `/root`, `/Users`, `/home` and a home directory.
fn broad(dir: &Path) -> bool {
    let parts: Vec<_> = dir.components().skip(1).map(|c| c.as_os_str()).collect();
    match parts.as_slice() {
        [] => true,
        [top] => ["root", "Users", "home"].iter().any(|b| top == b),
        [top, _] => ["Users", "home"].iter().any(|b| top == b),
        _ => false,
    }
}

pub fn root_of(dir: &Path) -> PathBuf {
    dir.ancestors()
        .take_while(|d| !broad(d))
        .find(|d| d.join(".git").symlink_metadata().is_ok())
        .map(main_of)
        .unwrap_or_else(|| dir.to_path_buf())
}

/// The repository a worktree was added from, as its `.git` file says; `repo` itself otherwise.
fn main_of(repo: &Path) -> PathBuf {
    let gitdir = std::fs::read_to_string(repo.join(".git"))
        .ok()
        .and_then(|text| text.lines().next()?.strip_prefix("gitdir:").map(|g| g.trim().to_owned()));
    let main = gitdir.and_then(|g| {
        let joined = normalize(&repo.join(g));
        let joined = joined.to_str()?;
        joined.split_once("/.git/worktrees/").map(|(main, _)| PathBuf::from(main))
    });
    main.filter(|m| m.is_dir()).unwrap_or_else(|| repo.to_path_buf())
}

/// `path` with `.` and `..` taken out, as Python's `os.path.normpath` does.
fn normalize(path: &Path) -> PathBuf {
    path.components().fold(PathBuf::new(), |mut out, c| {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_worktree_is_in_the_project_it_was_added_from() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("repo");
        let tree = tmp.path().join("repo-feature");
        fs::create_dir_all(main.join(".git/worktrees/feature")).unwrap();
        fs::create_dir_all(tree.join("src")).unwrap();
        fs::write(tree.join(".git"), "gitdir: ../repo/.git/worktrees/feature\n").unwrap();

        assert_eq!(root_of(&tree.join("src")), main);
        assert_eq!(root_of(&main), main);
        let loose = tmp.path().join("loose");
        assert_eq!(root_of(&loose), loose);
    }

    #[test]
    fn a_home_directory_is_no_project() {
        assert!(broad(Path::new("/")));
        assert!(broad(Path::new("/Users/me")));
        assert!(!broad(Path::new("/Users/me/work")));
    }
}
