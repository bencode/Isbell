//! Which connection owns each machine, and each machine's last state.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use redis::{AsyncCommands, Script};

use super::Bus;
use super::{conn_key, machines_key, state_key};

const CONN_TTL_SECS: u64 = 30;
const STATE_TTL_SECS: u64 = 900;

/// Extends a gateway's TTLs; re-claims a vanished key (Redis restart, flush or expiry), since
/// nobody else owns it then. Returns 0 only when another connection holds the machine.
const REFRESH: &str = r"
local cur = redis.call('GET', KEYS[1])
if cur == false then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
elseif cur ~= ARGV[1] then
  return 0
else
  redis.call('EXPIRE', KEYS[1], ARGV[4])
end
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[5])
return 1";

/// Drops a gateway's ownership; returns 1 when nobody owns the machine afterwards.
const RELEASE: &str = r"
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
if cur == false then return 1 end
return 0";

pub(super) struct Scripts {
    refresh: Script,
    release: Script,
}

impl Scripts {
    pub(super) fn new() -> Self {
        Self { refresh: Script::new(REFRESH), release: Script::new(RELEASE) }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("clock after epoch").as_millis() as u64
}

impl Bus {
    /// Takes ownership of `mid` for `conn`; returns the previous owner, if any.
    pub async fn claim_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<Option<String>> {
        let previous: Option<String> = redis::cmd("SET")
            .arg(conn_key(sid, mid))
            .arg(conn)
            .arg("EX")
            .arg(CONN_TTL_SECS)
            .arg("GET")
            .query_async(&mut self.cmd.clone())
            .await?;
        Ok(previous.filter(|p| p != conn))
    }

    /// Extends the gateway's TTLs; false only when another connection holds the machine.
    pub async fn refresh_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<bool> {
        let owned: i64 = self
            .scripts
            .refresh
            .key(conn_key(sid, mid))
            .key(state_key(sid, mid))
            .key(machines_key(sid))
            .arg(conn)
            .arg(mid)
            .arg(now_ms())
            .arg(CONN_TTL_SECS)
            .arg(STATE_TTL_SECS)
            .invoke_async(&mut self.cmd.clone())
            .await?;
        Ok(owned == 1)
    }

    /// Gives up `conn`'s ownership of `mid`; true when nobody owns the machine any more, false
    /// when another connection has taken it over.
    pub async fn release_gateway(&self, sid: &str, mid: &str, conn: &str) -> Result<bool> {
        let unowned: i64 = self
            .scripts
            .release
            .key(conn_key(sid, mid))
            .arg(conn)
            .invoke_async(&mut self.cmd.clone())
            .await?;
        Ok(unowned == 1)
    }

    pub async fn put_state(&self, sid: &str, mid: &str, json: &str) -> Result<()> {
        let machines = machines_key(sid);
        redis::pipe()
            .set_ex(state_key(sid, mid), json, STATE_TTL_SECS)
            .zadd(&machines, mid, now_ms())
            .expire(&machines, STATE_TTL_SECS as i64)
            .exec_async(&mut self.cmd.clone())
            .await?;
        Ok(())
    }

    /// Last known state of every machine seen in the last 15 minutes, with its online flag.
    pub async fn snapshot(&self, sid: &str) -> Result<Vec<(String, bool)>> {
        self.prune_machines(sid).await?;
        let mut cmd = self.cmd.clone();
        let mids: Vec<String> = cmd.zrange(machines_key(sid), 0, -1).await?;
        if mids.is_empty() {
            return Ok(Vec::new());
        }
        let pipe = mids.iter().fold(redis::pipe(), |mut pipe, mid| {
            pipe.get(state_key(sid, mid)).exists(conn_key(sid, mid));
            pipe
        });
        let rows: Vec<(Option<String>, bool)> = pipe.query_async(&mut cmd).await?;
        Ok(rows.into_iter().filter_map(|(state, online)| Some((state?, online))).collect())
    }

    /// Forgets machines not seen for 15 minutes.
    async fn prune_machines(&self, sid: &str) -> Result<()> {
        let cutoff = now_ms().saturating_sub(STATE_TTL_SECS * 1000);
        let _pruned: i64 = self.cmd.clone().zrembyscore(machines_key(sid), "-inf", cutoff).await?;
        Ok(())
    }
}
