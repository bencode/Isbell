use clap::Parser;
use isbell::cli::{self, Cli};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        // Only our own logs by default: libraries (webrtc above all) are noisy at info.
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("isbell=info")),
        )
        .init();
    if let Err(err) = cli::run(Cli::parse()).await {
        err.exit();
    }
}
