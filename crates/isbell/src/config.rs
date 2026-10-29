//! Local configuration:
//!
//! ```text
//! dir         = $ISBELL_CONFIG_DIR | $XDG_CONFIG_HOME/isbell | $HOME/.config/isbell
//! key         : the space key string (0600)
//! push.json   : the phones subscribed to this machine's pushes (0600)
//! config.toml : relay = "…"; stun = ["stun:host:port", …]; uploads = "/abs/dir";
//!               [machine] id, name (machine is created by the first `gateway run`)
//! ```

use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

use anyhow::{Context, Result};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineInfo;
use serde::{Deserialize, Serialize};

use crate::env_path;

const DEFAULT_RELAY: &str = "wss://isbell.fmap.dev/v1/ws";
/// Public STUN servers: they tell each end of a direct link its public address.
const DEFAULT_STUN: [&str; 2] = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stun: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<MachineConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uploads: Option<PathBuf>,
}

impl Config {
    /// STUN servers for direct links; an empty list means local candidates only.
    pub fn stun(&self) -> Vec<String> {
        let default = || DEFAULT_STUN.map(str::to_owned).to_vec();
        self.stun.clone().unwrap_or_else(default)
    }

    /// Where files sent for agents go: `uploads` when it is absolute, else the system's temporary
    /// directory, as a relative path would hand agents a path they cannot resolve.
    pub fn uploads(&self) -> PathBuf {
        let temp = || std::env::temp_dir().join("isbell-uploads");
        match &self.uploads {
            Some(dir) if dir.is_absolute() => dir.clone(),
            Some(dir) => {
                tracing::warn!(dir = %dir.display(), "uploads is not an absolute path; ignoring it");
                temp()
            }
            None => temp(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineConfig {
    pub id: String,
    pub name: String,
}

impl MachineConfig {
    pub fn generate() -> Self {
        let hostname = hostname();
        let name: String =
            hostname.split('.').next().unwrap_or_default().chars().take(64).collect();
        Self {
            id: format!("{:016x}", rand::random::<u64>()),
            name: if name.is_empty() { "machine".into() } else { name },
        }
    }

    pub fn info(&self) -> MachineInfo {
        MachineInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            hostname: hostname().chars().take(255).collect(),
            os: std::env::consts::OS.into(),
            version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}

fn hostname() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

pub struct Paths {
    pub dir: PathBuf,
}

impl Paths {
    pub fn resolve() -> Result<Paths> {
        let dir = env_path("ISBELL_CONFIG_DIR")
            .or_else(|| env_path("XDG_CONFIG_HOME").map(|d| d.join("isbell")))
            .or_else(|| env_path("HOME").map(|h| h.join(".config").join("isbell")))
            .context("cannot locate the config directory: set HOME or ISBELL_CONFIG_DIR")?;
        Ok(Paths { dir })
    }

    fn key_file(&self) -> PathBuf {
        self.dir.join("key")
    }

    pub fn push_file(&self) -> PathBuf {
        self.dir.join("push.json")
    }

    fn config_file(&self) -> PathBuf {
        self.dir.join("config.toml")
    }

    fn ensure_dir(&self) -> Result<()> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.dir)
            .with_context(|| format!("cannot create {}", self.dir.display()))
    }

    pub fn read_key(&self) -> Result<Option<Identity>> {
        match fs::read_to_string(self.key_file()) {
            Ok(key) => Identity::parse(&key)
                .map(Some)
                .with_context(|| format!("invalid key in {}", self.key_file().display())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => {
                Err(err).with_context(|| format!("cannot read {}", self.key_file().display()))
            }
        }
    }

    pub fn write_key(&self, id: &Identity) -> Result<()> {
        self.ensure_dir()?;
        let path = self.key_file();
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .with_context(|| format!("cannot write {}", path.display()))?;
        // `mode` only applies when creating; tighten a key file that already existed.
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        writeln!(file, "{}", id.key_string())?;
        Ok(())
    }

    pub fn remove_key(&self) -> Result<()> {
        match fs::remove_file(self.key_file()) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        }
    }

    pub fn load(&self) -> Result<Config> {
        let path = self.config_file();
        match fs::read_to_string(&path) {
            Ok(text) => {
                toml::from_str(&text).with_context(|| format!("invalid {}", path.display()))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(err) => Err(err).with_context(|| format!("cannot read {}", path.display())),
        }
    }

    pub fn save(&self, config: &Config) -> Result<()> {
        self.ensure_dir()?;
        let path = self.config_file();
        fs::write(&path, toml::to_string(config)?)
            .with_context(|| format!("cannot write {}", path.display()))
    }
}

/// `--relay` / `$ISBELL_RELAY` (already merged by clap) > config.toml > default.
pub fn resolve_relay(flag: Option<&str>, config: &Config) -> String {
    flag.or(config.relay.as_deref()).unwrap_or(DEFAULT_RELAY).to_owned()
}
