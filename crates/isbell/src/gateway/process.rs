//! `isbell.pane.processes`: the processes in a pane's foreground, as herdr lists them, with when each
//! started, which herdr does not say. A client matches an agent that reports no session to the
//! record it wrote since it started.

use isbell_proto::frame::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use super::herdr::{Herdr, REQUEST_TIMEOUT};

#[derive(Debug, Deserialize)]
struct Listed {
    pid: u32,
    name: String,
    #[serde(default)]
    argv: Option<Vec<String>>,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
struct Process {
    pid: u32,
    name: String,
    argv: Option<Vec<String>>,
    cwd: Option<String>,
    /// Unix milliseconds.
    started: Option<u64>,
}

pub async fn processes(herdr: &Herdr, p: Value) -> Result<Value, RpcError> {
    #[derive(Deserialize)]
    struct Params {
        pane_id: String,
    }
    let Params { pane_id } = serde_json::from_value(p).map_err(RpcError::bad_request)?;
    let info = herdr
        .request("pane.process_info", json!({ "pane_id": pane_id }), Some(REQUEST_TIMEOUT))
        .await?;
    let unexpected =
        |why: String| RpcError::new("protocol", format!("unexpected herdr process list: {why}"));
    let found = info.pointer("/process_info/foreground_processes").cloned();
    let listed: Vec<Listed> =
        serde_json::from_value(found.ok_or_else(|| unexpected("none given".into()))?)
            .map_err(|err| unexpected(err.to_string()))?;
    // Reading the process table may take a moment: off the async workers.
    let found = tokio::task::spawn_blocking(move || with_started(listed))
        .await
        .map_err(|err| RpcError::new("internal", err.to_string()))??;
    Ok(json!({ "processes": found }))
}

fn with_started(listed: Vec<Listed>) -> Result<Vec<Process>, RpcError> {
    let pids: Vec<Pid> = listed.iter().map(|p| Pid::from_u32(p.pid)).collect();
    let mut sys = System::new()
        .map_err(|err| RpcError::new("unavailable", format!("cannot read this system: {err}")))?;
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing(),
    );
    let started = |pid: u32| sys.process(Pid::from_u32(pid)).map(|p| p.start_time() * 1000);
    Ok(listed
        .into_iter()
        .map(|p| Process {
            started: started(p.pid),
            pid: p.pid,
            name: p.name,
            argv: p.argv,
            cwd: p.cwd,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_when_a_process_started() {
        let me = Listed { pid: std::process::id(), name: "isbell".into(), argv: None, cwd: None };
        let found = with_started(vec![me]).unwrap();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
        assert!(found[0].started.is_some_and(|ms| ms > 0 && u128::from(ms) <= now.as_millis()));
    }
}
