//! Tables on a terminal, JSON otherwise; errors as JSON on stderr with exit code 1.

use std::io::IsTerminal;

use isbell_proto::frame::RpcError;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Copy)]
pub struct Output {
    pub json: bool,
}

impl Output {
    pub fn new(force_json: bool) -> Self {
        Self {
            json: force_json || !std::io::stdout().is_terminal(),
        }
    }

    pub fn json(&self, value: &impl Serialize) {
        let text = if std::io::stdout().is_terminal() {
            serde_json::to_string_pretty(value)
        } else {
            serde_json::to_string(value)
        };
        println!("{}", text.expect("values serialize"));
    }

    pub fn table(&self, headers: &[&str], rows: &[Vec<String>]) {
        let widths: Vec<usize> = (0..headers.len())
            .map(|i| {
                rows.iter()
                    .map(|r| r[i].chars().count())
                    .chain([headers[i].len()])
                    .max()
                    .unwrap_or(0)
            })
            .collect();
        let line = |cells: Vec<&str>| {
            let padded: Vec<String> = cells
                .iter()
                .zip(&widths)
                .map(|(c, w)| format!("{c:<w$}"))
                .collect();
            println!("{}", padded.join("  ").trim_end());
        };
        line(headers.to_vec());
        for row in rows {
            line(row.iter().map(String::as_str).collect());
        }
    }
}

#[derive(Debug)]
pub struct CliError {
    pub code: String,
    pub message: String,
}

impl CliError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn exit(self) -> ! {
        eprintln!("{}", json!({"code": self.code, "message": self.message}));
        std::process::exit(1)
    }
}

impl From<RpcError> for CliError {
    fn from(err: RpcError) -> Self {
        Self {
            code: err.code,
            message: err.msg,
        }
    }
}

impl From<anyhow::Error> for CliError {
    fn from(err: anyhow::Error) -> Self {
        Self {
            code: "error".into(),
            message: format!("{err:#}"),
        }
    }
}

impl From<crate::relay::RelayError> for CliError {
    fn from(err: crate::relay::RelayError) -> Self {
        Self {
            code: "relay_error".into(),
            message: err.to_string(),
        }
    }
}

/// Human age of a gateway timestamp (ms), e.g. `42s`, `5m`, `3h`, `2d`.
pub fn age(since_ms: u64, now_ms: u64) -> String {
    let secs = now_ms.saturating_sub(since_ms) / 1000;
    match secs {
        s if s < 60 => format!("{s}s"),
        s if s < 3600 => format!("{}m", s / 60),
        s if s < 86400 => format!("{}h", s / 3600),
        s => format!("{}d", s / 86400),
    }
}

pub fn value_str(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_owned)
}
