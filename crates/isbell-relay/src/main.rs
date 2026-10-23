use anyhow::Result;
use isbell_relay::config::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let config = Config::from_env()?;
    let relay = isbell_relay::serve(config).await?;
    tracing::info!(addr = %relay.addr, "relay listening");
    tokio::select! {
        signal = tokio::signal::ctrl_c() => signal?,
        () = relay.failed() => anyhow::bail!("the relay can no longer serve (redis pub/sub lost or server stopped); exiting so a supervisor restarts it"),
    }
    relay.shutdown();
    Ok(())
}
