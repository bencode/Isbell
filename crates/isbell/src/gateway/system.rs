//! `isbell.system`: what this machine is and how loaded it is, for a page's machine panel.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use isbell_proto::frame::RpcError;
use serde::Serialize;
use serde_json::Value;
use sysinfo::{CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};

use crate::env_path;

/// Keeps one `System` across calls: CPU usage is the change between two refreshes, so each read
/// reports the load since the one before.
pub struct Sampler(Mutex<Option<Sample>>);

struct Sample {
    sys: System,
    at: Instant,
}

/// Past this since the last read, the usage since then says little of now (a panel reopened after
/// an hour): the read takes two samples of its own instead.
const STALE: Duration = Duration::from_secs(5);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    os: Option<String>,
    uptime_secs: Option<u64>,
    cpu: Cpu,
    load: Option<Load>,
    memory: Memory,
    disk: Option<Disk>,
}

#[derive(Serialize)]
struct Cpu {
    brand: String,
    cores: Option<usize>,
    threads: usize,
    arch: String,
    /// Percent of all CPUs, 0–100.
    usage: f32,
}

#[derive(Serialize)]
struct Load {
    one: f64,
    five: f64,
    fifteen: f64,
}

/// Bytes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Memory {
    total: u64,
    used: u64,
    swap_total: u64,
    swap_used: u64,
}

/// The disk holding the home directory, where agents work; bytes.
#[derive(Debug, PartialEq, Serialize)]
struct Disk {
    mount: String,
    total: u64,
    free: u64,
}

impl Sampler {
    pub fn new() -> Sampler {
        Sampler(Mutex::new(None))
    }

    /// Blocks for sysinfo's minimum interval when there is no recent sample to measure from.
    pub fn read(&self) -> Result<Value, RpcError> {
        let mut slot = self.0.lock().expect("system sampler poisoned");
        let (mut sys, at) = match slot.take() {
            Some(Sample { sys, at }) => (sys, Some(at)),
            None => (new_system()?, None),
        };
        if at.is_none_or(|at| at.elapsed() > STALE) {
            sys.refresh_cpu_usage();
            std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        }
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let report = report(&sys);
        *slot = Some(Sample { sys, at: Instant::now() });
        serde_json::to_value(report).map_err(|err| RpcError::new("internal", err.to_string()))
    }
}

fn new_system() -> Result<System, RpcError> {
    let kind = RefreshKind::nothing()
        .with_cpu(CpuRefreshKind::nothing().with_usage())
        .with_memory(MemoryRefreshKind::everything());
    System::new_with_specifics(kind)
        .map_err(|err| RpcError::new("unavailable", format!("cannot read this system: {err}")))
}

fn report(sys: &System) -> Report {
    Report {
        os: optional("the OS version", System::long_os_version()),
        uptime_secs: optional("the uptime", System::uptime()),
        cpu: Cpu {
            brand: sys.cpus().first().map(|cpu| cpu.brand().trim().to_owned()).unwrap_or_default(),
            cores: optional("the core count", System::physical_core_count()),
            threads: sys.cpus().len(),
            arch: System::cpu_arch(),
            usage: sys.global_cpu_usage(),
        },
        load: optional("the load average", System::load_average()).map(|l| Load {
            one: l.one,
            five: l.five,
            fifteen: l.fifteen,
        }),
        memory: Memory {
            total: sys.total_memory(),
            used: sys.used_memory(),
            swap_total: sys.total_swap(),
            swap_used: sys.used_swap(),
        },
        disk: home_disk_now(),
    }
}

fn home_disk_now() -> Option<Disk> {
    let home = env_path("HOME")?;
    let kind = DiskRefreshKind::nothing().with_storage();
    let disks = optional("the disks", Disks::new_with_refreshed_list_specifics(kind))?;
    let found = disks.iter().map(|d| Disk {
        mount: d.mount_point().to_string_lossy().into_owned(),
        total: d.total_space(),
        free: d.available_space(),
    });
    home_disk(found, &home)
}

/// The disk mounted deepest above `home`, as with a separate `/home`.
fn home_disk(disks: impl IntoIterator<Item = Disk>, home: &Path) -> Option<Disk> {
    disks
        .into_iter()
        .filter(|d| home.starts_with(&d.mount))
        .max_by_key(|d| Path::new(&d.mount).components().count())
}

/// A fact this platform may not offer: none when unsupported, logged when reading it failed.
fn optional<T>(what: &str, read: Result<T, sysinfo::Error>) -> Option<T> {
    match read {
        Ok(value) => Some(value),
        Err(sysinfo::Error::Unsupported) => None,
        Err(err) => {
            tracing::warn!(%err, "could not read {what}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk(mount: &str) -> Disk {
        Disk { mount: mount.into(), total: 2, free: 1 }
    }

    #[test]
    fn picks_the_disk_mounted_deepest_above_home() {
        let disks = [disk("/"), disk("/home"), disk("/mnt/backup")];
        let home = Path::new("/home/me");
        assert_eq!(home_disk(disks, home), Some(disk("/home")));
        assert_eq!(home_disk([disk("/mnt/backup")], home), None);
    }

    #[test]
    fn reads_this_machine() {
        let sampler = Sampler::new();
        sampler.read().unwrap();
        let report = sampler.read().unwrap();
        assert!(report["memory"]["total"].as_u64().unwrap() > 0);
        assert!(report["cpu"]["threads"].as_u64().unwrap() >= 1);
        let usage = report["cpu"]["usage"].as_f64().unwrap();
        assert!((0.0..=100.0).contains(&usage), "usage {usage}");
    }
}
