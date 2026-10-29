//! The phones subscribed on this machine, kept in a file of their own (`push.json` in the config
//! directory), one per push endpoint.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subscription {
    pub endpoint: String,
    /// The phone's public key and auth secret, base64url, as its browser gives them.
    pub p256dh: String,
    pub auth: String,
    pub texts: Texts,
}

/// The titles in the phone's language, `{name}` standing for the agent's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Texts {
    pub blocked: String,
    pub done: String,
}

pub struct Store {
    file: PathBuf,
    subs: Mutex<Vec<Subscription>>,
}

impl Store {
    /// What the file holds; none when it is missing or cannot be read, the phones subscribing again
    /// when Isbell next opens on them.
    pub fn load(file: PathBuf) -> Store {
        let subs = match fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                tracing::error!(file = %file.display(), %err, "ignoring unreadable push subscriptions");
                Vec::new()
            }),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(err) => {
                tracing::error!(file = %file.display(), %err, "cannot read push subscriptions");
                Vec::new()
            }
        };
        Store { file, subs: Mutex::new(subs) }
    }

    pub fn all(&self) -> Vec<Subscription> {
        self.subs.lock().expect("push store poisoned").clone()
    }

    /// Adds `sub`, or replaces the one with its endpoint.
    pub fn put(&self, sub: Subscription) -> io::Result<()> {
        self.change(|subs| {
            subs.retain(|s| s.endpoint != sub.endpoint);
            subs.push(sub);
        })
    }

    pub fn remove(&self, endpoint: &str) -> io::Result<()> {
        self.change(|subs| subs.retain(|s| s.endpoint != endpoint))
    }

    fn change(&self, edit: impl FnOnce(&mut Vec<Subscription>)) -> io::Result<()> {
        let mut subs = self.subs.lock().expect("push store poisoned");
        edit(&mut subs);
        // Written aside and renamed over, so a crash never leaves half a file; readable by its owner
        // alone, as the subscriptions let anyone push to the phones.
        let tmp = self.file.with_extension("json.tmp");
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        out.write_all(&serde_json::to_vec_pretty(&*subs).expect("subscriptions serialize"))?;
        out.sync_all()?;
        fs::rename(&tmp, &self.file)
    }
}
