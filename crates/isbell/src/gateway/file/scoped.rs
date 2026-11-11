//! Where a shared file's readers may read: under the share's root, as the page's own files are, and
//! nothing hidden. A reader can ask for any path, so this is the whole of what keeps them in; every
//! refusal looks alike, so it tells them nothing of what is there.

use std::path::{Path, PathBuf};

use isbell_proto::frame::RpcError;

/// Names of keys and certificates, refused wherever they are.
const SECRET_SUFFIXES: [&str; 4] = [".pem", ".key", ".p12", ".pfx"];
const SECRET_PREFIXES: [&str; 3] = ["id_rsa", "id_ed25519", "id_ecdsa"];

/// The file at `rel` under `root`, symlinks resolved; refused when `rel` climbs out, names anything
/// hidden or secret, or leads out of `root` by a symlink.
pub fn scoped(root: &Path, rel: &str) -> Result<PathBuf, RpcError> {
    let segments: Vec<&str> = rel.split('/').collect();
    if rel.is_empty() || segments.iter().any(|s| s.is_empty() || s.starts_with('.')) {
        return Err(refused());
    }
    if segments.last().is_some_and(|name| secret(name)) {
        return Err(refused());
    }
    let root = root.canonicalize().map_err(|_| refused())?;
    let real = root.join(rel).canonicalize().map_err(|_| refused())?;
    // A symlink may lead anywhere; what it leads to is held to the same rules.
    let inside = real.strip_prefix(&root).map_err(|_| refused())?;
    let hidden = inside.iter().any(|s| s.to_string_lossy().starts_with('.'));
    if hidden || inside.file_name().is_some_and(|name| secret(&name.to_string_lossy())) {
        return Err(refused());
    }
    Ok(real)
}

fn secret(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    SECRET_SUFFIXES.iter().any(|s| name.ends_with(s))
        || SECRET_PREFIXES.iter().any(|p| name.starts_with(p))
}

fn refused() -> RpcError {
    RpcError::new("not_found", "no such file")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;

    use super::*;

    #[test]
    fn reads_only_what_is_plainly_under_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let (root, outside) = (dir.path().join("proj"), dir.path().join("outside.txt"));
        for path in ["design/home.html", ".env", ".git/config", "keys/server.pem", "ssh/id_rsa"] {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "x").unwrap();
        }
        fs::write(&outside, "x").unwrap();
        symlink(&outside, root.join("design/out.txt")).unwrap();
        symlink(root.join(".env"), root.join("design/env.txt")).unwrap();

        let real = root.canonicalize().unwrap().join("design/home.html");
        assert_eq!(scoped(&root, "design/home.html").unwrap(), real);
        let refused = [
            "",
            "/etc/passwd",
            "design/../.env",
            "../outside.txt",
            "design//home.html",
            ".env",
            ".git/config",
            "keys/server.pem",
            "ssh/id_rsa",
            "design/out.txt",
            "design/env.txt",
            "design/missing.html",
        ];
        for rel in refused {
            assert_eq!(scoped(&root, rel).unwrap_err().code, "not_found", "{rel:?}");
        }
    }
}
