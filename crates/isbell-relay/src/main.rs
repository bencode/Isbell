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
        () = relay.failed() => anyhow::bail!("redis pub/sub connection lost; exiting so a supervisor can restart the relay"),
    }
    relay.shutdown();
    Ok(())
}
