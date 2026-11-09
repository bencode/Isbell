//! `isbell terminal share`: a read-only link to a pane, for anyone to watch it live. The machine
//! keeps the share; this command only starts or stops it, and needs no terminal of its own.

use std::time::Duration;

use serde_json::{Value, json};

use super::super::Ctx;
use super::super::output::CliError;
use super::super::target::parse_target;
use crate::now_ms;

const CALL_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn run(ctx: &Ctx, target: &str, stop: bool) -> Result<(), CliError> {
    let target = parse_target(target)?;
    let (session, state) = ctx.machine(target.machine).await?;
    let named = state.agents.iter().find(|a| a.name.as_deref() == Some(target.agent));
    let pane = named.map_or(target.agent, |a| a.pane_id.as_str());
    let method = if stop { "isbell.share.stop" } else { "isbell.share.start" };
    let params = json!({"paneId": pane});
    let answer = session.call(&state.machine.id, method, params, Some(CALL_TIMEOUT)).await?;
    session.close().await;
    if stop {
        if ctx.out.json {
            ctx.out.json(&json!({"stopped": pane}));
        } else {
            println!("stopped sharing {pane}");
        }
        return Ok(());
    }
    report(ctx, &answer)
}

fn report(ctx: &Ctx, answer: &Value) -> Result<(), CliError> {
    let (key, expires_at) = (answer["key"].as_str(), answer["expiresAt"].as_u64());
    let (Some(key), Some(expires_at)) = (key, expires_at) else {
        return Err(CliError::new("bad_response", "the machine's answer has no link"));
    };
    let url = watch_url(&ctx.relay, key);
    if ctx.out.json {
        ctx.out.json(&json!({"url": url, "expiresAt": expires_at}));
        return Ok(());
    }
    let minutes = expires_at.saturating_sub(now_ms()) / 60_000;
    println!("{url}");
    println!(
        "Anyone with this link can watch, read-only, for {}h {}m.",
        minutes / 60,
        minutes % 60
    );
    println!("Everything on the screen is visible to them, including printed secrets.");
    Ok(())
}

/// The web app is served where the relay is: `wss://host/v1/ws` → `https://host/watch#<key>`.
fn watch_url(relay: &str, key: &str) -> String {
    let (scheme, rest) = relay.split_once("://").unwrap_or(("wss", relay));
    let host = rest.split('/').next().unwrap_or(rest);
    let web = if scheme == "ws" { "http" } else { "https" };
    format!("{web}://{host}/watch#{key}")
}
