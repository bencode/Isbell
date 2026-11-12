//! `isbell upgrade`: the install script, which installs the latest release in place of this one and
//! restarts the gateway service. The gateway runs the same command when a client asks it to upgrade.

use std::process::Command;

use super::output::CliError;

const INSTALL_SCRIPT: &str = "https://isbell.fmap.dev/install.sh";

/// Downloads the script whole before running it, and runs it only if it is one: a failed download
/// fails the upgrade rather than running nothing, and the site answers a path it does not have with
/// its web page. The script asks its questions on the terminal itself, so it runs from a pipe as
/// `curl | sh` runs it; `ISBELL_VERSION` reaches it, to go back to a release.
pub(crate) fn install_command() -> Command {
    let script = r#"s=$(curl -fsSL --connect-timeout 15 --max-time 60 "$1") || exit 1
case $s in
'#!/bin/sh'*) printf '%s\n' "$s" | sh ;;
*) echo "isbell upgrade: $1 is not the install script" >&2; exit 1 ;;
esac"#;
    let mut command = Command::new("sh");
    command.args(["-c", script, "sh", INSTALL_SCRIPT]);
    command
}

pub fn run() -> Result<(), CliError> {
    let status = install_command()
        .status()
        .map_err(|err| CliError::new("upgrade_failed", format!("cannot run sh: {err}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(CliError::new("upgrade_failed", format!("the install script failed ({status})")))
    }
}
