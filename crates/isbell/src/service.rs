//! The gateway as a launchd user agent (macOS): started at login, restarted after a failure, and
//! left stopped after a clean exit (another gateway took the machine over).

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use anyhow::{Context, Result, bail};
use serde::Serialize;

pub const LABEL: &str = "dev.fmap.isbell.gateway";

#[derive(Debug, Serialize)]
pub struct Files {
    pub plist: PathBuf,
    pub log: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub installed: bool,
    pub running: bool,
    pub pid: Option<u32>,
}

/// What launchd runs; see launchd.plist(5).
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Agent {
    label: &'static str,
    program_arguments: Vec<PathBuf>,
    /// launchd's own PATH would find neither herdr nor the agents.
    environment_variables: BTreeMap<&'static str, String>,
    run_at_load: bool,
    keep_alive: KeepAlive,
    /// The herdr server the gateway started outlives the service.
    abandon_process_group: bool,
    working_directory: PathBuf,
    standard_out_path: PathBuf,
    standard_error_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KeepAlive {
    /// false: restart only after a failure.
    successful_exit: bool,
}

/// Writes the service for `exe` with `path_env` as its PATH, and (re)starts it.
pub fn install(exe: &Path, path_env: &OsStr) -> Result<Files> {
    let home = home()?;
    let files = files(&home);
    for dir in [files.plist.parent(), files.log.parent()].into_iter().flatten() {
        std::fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    }
    if loaded()? {
        launchctl(&["bootout", &target()])?;
    }
    let agent = agent(exe, path_env, &home, &files.log);
    plist::to_file_xml(&files.plist, &agent).context("cannot write the service file")?;
    launchctl(&["bootstrap", &domain(), &files.plist.to_string_lossy()])?;
    Ok(files)
}

/// Stops the service and removes it; false when it was not installed.
pub fn uninstall() -> Result<bool> {
    if loaded()? {
        launchctl(&["bootout", &target()])?;
    }
    let plist = files(&home()?).plist;
    match std::fs::remove_file(&plist) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err).with_context(|| format!("cannot remove {}", plist.display())),
    }
}

pub fn status() -> Result<Status> {
    let installed = files(&home()?).plist.exists();
    let printed = print()?;
    let pid = match printed.status.success() {
        true => pid(&String::from_utf8_lossy(&printed.stdout)),
        false => None,
    };
    Ok(Status { installed, running: pid.is_some(), pid })
}

fn agent(exe: &Path, path_env: &OsStr, home: &Path, log: &Path) -> Agent {
    Agent {
        label: LABEL,
        program_arguments: vec![exe.to_owned(), "gateway".into(), "run".into()],
        environment_variables: BTreeMap::from([("PATH", path_env.to_string_lossy().into_owned())]),
        run_at_load: true,
        keep_alive: KeepAlive { successful_exit: false },
        abandon_process_group: true,
        working_directory: home.to_owned(),
        standard_out_path: log.to_owned(),
        standard_error_path: log.to_owned(),
    }
}

fn files(home: &Path) -> Files {
    Files {
        plist: home.join("Library/LaunchAgents").join(format!("{LABEL}.plist")),
        log: home.join("Library/Logs/isbell/gateway.log"),
    }
}

fn home() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty());
    home.map(PathBuf::from).context("HOME is not set")
}

/// This user's login session, where user agents run.
fn domain() -> String {
    format!("gui/{}", rustix::process::getuid().as_raw())
}

fn target() -> String {
    format!("{}/{LABEL}", domain())
}

fn loaded() -> Result<bool> {
    Ok(print()?.status.success())
}

/// `launchctl print` of the service; it fails while the service is not loaded.
fn print() -> Result<Output> {
    Command::new("launchctl").args(["print", &target()]).output().context("cannot run launchctl")
}

/// The service's own `pid = …` line (one tab deep), present while it runs.
fn pid(printed: &str) -> Option<u32> {
    printed.lines().find_map(|line| line.strip_prefix("\tpid = ")?.parse().ok())
}

fn launchctl(args: &[&str]) -> Result<()> {
    let output = Command::new("launchctl").args(args).output().context("cannot run launchctl")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("launchctl {} failed: {}", args[0], stderr.trim());
    }
    Ok(())
}
