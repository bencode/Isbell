//! What the end-to-end test runs against: a real relay behind a TCP forwarder that can cut a
//! connection like a lost network, a fake herdr, and the space and machine the test uses.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use isbell::gateway::{self, GatewayError, GatewayOptions};
use isbell_proto::identity::Identity;
use isbell_proto::state::MachineInfo;
use isbell_relay::config::{Config, Limits};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::fake_herdr::{FakeHerdr, fake_herdr};

/// The relay, the fake herdr, and the space and machine the test uses.
pub struct Harness {
    pub relay: isbell_relay::RelayHandle,
    pub forwarder: Forwarder,
    pub url: String,
    pub herdr: FakeHerdr,
    pub terminal_log: PathBuf,
    pub id: Identity,
    pub machine: MachineInfo,
    _dir: tempfile::TempDir,
}

impl Harness {
    pub async fn start() -> Harness {
        // Everyone reaches the relay through the forwarder, so the relay's origin is the forwarder's.
        let relay_port = free_port();
        let forwarder = Forwarder::start(relay_port).await;
        let relay = isbell_relay::serve(Config {
            bind: ([127, 0, 0, 1], relay_port).into(),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            public_origin: format!("ws://127.0.0.1:{}", forwarder.port),
            trust_proxy: false,
            limits: Limits::default(),
        })
        .await
        .expect("relay needs a reachable Redis (docker compose up -d redis)");
        let url = format!("ws://127.0.0.1:{}/v1/ws", forwarder.port);

        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("herdr.sock");
        let herdr = fake_herdr(&socket);
        let terminal_log = dir.path().join("terminal.log");
        // The only test in this binary, so these process-wide variables cannot race.
        unsafe {
            std::env::set_var("ISBELL_HERDR_SOCKET", &socket);
            std::env::set_var(
                "ISBELL_HERDR_BIN",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fake-herdr.sh"),
            );
            std::env::set_var("FAKE_HERDR_LOG", &terminal_log);
        }
        let machine = MachineInfo {
            id: format!("{:016x}", rand::random::<u64>()),
            name: "fake".into(),
            hostname: "fake.local".into(),
            os: "macos".into(),
            version: "0".into(),
        };
        let id = Identity::generate();
        Harness { relay, forwarder, url, herdr, terminal_log, id, machine, _dir: dir }
    }

    /// Starts a gateway process for the test machine.
    pub fn spawn_gateway(&self) -> JoinHandle<Result<(), GatewayError>> {
        tokio::spawn(gateway::run(GatewayOptions {
            relay: self.url.clone(),
            identity: Identity::parse(&self.id.key_string()).unwrap(),
            machine: self.machine.clone(),
            // Host candidates only: everything runs on this machine.
            ice: vec![],
        }))
    }
}

/// TCP forwarder; `cut(i)` drops the i-th accepted connection on the client side only and keeps
/// the relay side open, as when a gateway loses its network without the relay noticing.
pub struct Forwarder {
    port: u16,
    links: Arc<Mutex<Vec<Arc<Notify>>>>,
}

impl Forwarder {
    async fn start(upstream_port: u16) -> Forwarder {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let links: Arc<Mutex<Vec<Arc<Notify>>>> = Arc::default();
        let registry = Arc::clone(&links);
        tokio::spawn(async move {
            loop {
                let (down, _) = listener.accept().await.unwrap();
                let up = TcpStream::connect(("127.0.0.1", upstream_port)).await.unwrap();
                let cut = Arc::new(Notify::new());
                registry.lock().unwrap().push(Arc::clone(&cut));
                tokio::spawn(async move {
                    let (mut dr, mut dw) = down.into_split();
                    let (mut ur, mut uw) = up.into_split();
                    let was_cut = tokio::select! {
                        _ = tokio::io::copy(&mut dr, &mut uw) => false,
                        _ = tokio::io::copy(&mut ur, &mut dw) => false,
                        _ = cut.notified() => true,
                    };
                    drop((dr, dw));
                    if was_cut {
                        std::future::pending::<()>().await;
                    }
                    drop((ur, uw));
                });
            }
        });
        Forwarder { port, links }
    }

    pub fn cut(&self, link: usize) {
        self.links.lock().unwrap()[link].notify_one();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}
