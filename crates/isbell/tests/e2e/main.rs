//! relay + gateway + client session against a fake herdr: calls, agent start, terminals, files (also
//! over a direct link), and what happens to calls in flight when the gateway reconnects, is taken
//! over, or goes offline.
//! Needs a real Redis (`docker compose up -d redis`, or REDIS_URL).

mod checks;
mod direct;
mod failover;
mod fake_herdr;
mod files;
mod harness;

use std::sync::Arc;

use isbell::client::Session;

use crate::harness::Harness;

#[tokio::test]
async fn gateway_serves_cli_through_relay() {
    let harness = Harness::start().await;
    let (mid, calls, log) = (&harness.machine.id, &harness.herdr.calls, &harness.terminal_log);
    let session = Arc::new(Session::connect(&harness.url, &harness.id).await.unwrap()); // link 0
    let mut events = session.events();
    let first_gateway = harness.spawn_gateway(); // link 1

    checks::comes_online(&session, &mut events, mid).await;
    checks::herdr_calls(&session, mid).await;
    checks::agent_start(&session, mid, calls).await;
    checks::terminal_control(&session, mid, log).await;
    checks::terminal_new(&session, mid, log, calls).await;
    checks::terminal_observe(&session, mid, log).await;
    checks::closing_ends_streams(&harness.url, &harness.id, mid, log).await;
    files::read(&session, mid).await;
    files::write(&session, mid).await;
    files::list_and_search(&session, mid).await;
    direct::serves_streams(&harness).await;

    failover::reconnect(&session, &mut events, &harness).await;
    let second_gateway = failover::takeover(&session, &mut events, &harness, first_gateway).await;
    failover::offline(&session, &mut events, &harness, second_gateway).await;
    harness.relay.shutdown();
}
