//! Isbell's agent hook, kept as new as this isbell: every agent runs the one installed copy,
//! `~/.isbell/hooks/agent-hook.sh`, so replacing it upgrades the hook for all of them. A machine
//! without the hook is left without it: installing it registers it with the agents, which only the
//! user decides.

use std::path::Path;

use crate::env_path;

const BUNDLED: &str = include_str!("../../../../integrations/agent-hook.sh");
const VERSION: &str = "ISBELL_HOOK_VERSION=";

fn hook_version(script: &str) -> Option<u32> {
    script.lines().find_map(|line| line.strip_prefix(VERSION)?.trim().parse().ok())
}

/// Only an older hook than the bundled one, both of them readable, is replaced.
fn should_replace(installed: &str, bundled: &str) -> bool {
    matches!((hook_version(installed), hook_version(bundled)), (Some(have), Some(want)) if have < want)
}

/// Replaces the installed hook when it is older; never fails the gateway.
pub fn refresh() {
    let Some(home) = env_path("HOME") else { return };
    let path = home.join(".isbell/hooks/agent-hook.sh");
    if let Err(err) = replace(&path) {
        tracing::warn!(%err, path = %path.display(), "cannot update the agent hook");
    }
}

fn replace(path: &Path) -> std::io::Result<()> {
    let installed = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    if !should_replace(&installed, BUNDLED) {
        return Ok(());
    }
    // Written beside it and moved over it, so an agent never runs half a hook.
    let tmp = path.with_extension("sh.isbell-tmp");
    std::fs::write(&tmp, BUNDLED)?;
    std::fs::set_permissions(&tmp, std::fs::metadata(path)?.permissions())?;
    std::fs::rename(&tmp, path)?;
    tracing::info!(path = %path.display(), version = ?hook_version(BUNDLED), "updated the agent hook");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_line() {
        assert_eq!(hook_version("#!/bin/sh\nISBELL_HOOK_VERSION=5\n"), Some(5));
        assert_eq!(hook_version("#!/bin/sh\n"), None);
        assert!(hook_version(BUNDLED).is_some());
    }

    #[test]
    fn replaces_only_an_older_hook() {
        let v = |n: &str| format!("ISBELL_HOOK_VERSION={n}\n");
        assert!(should_replace(&v("4"), &v("5")));
        assert!(!should_replace(&v("5"), &v("5")));
        assert!(!should_replace(&v("6"), &v("5")));
        assert!(!should_replace("not a hook", &v("5")));
        assert!(!should_replace(&v("4"), "not a hook"));
    }

    #[test]
    fn replaces_the_file_keeping_its_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent-hook.sh");
        std::fs::write(&path, "ISBELL_HOOK_VERSION=0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        replace(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), BUNDLED);
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
        let absent = dir.path().join("none.sh");
        replace(&absent).unwrap();
        assert!(!absent.exists());
    }
}
