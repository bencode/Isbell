//! Client side of the relay WebSocket: challenge → origin check → signed auth → frames.

use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use isbell_proto::frame::{Encoded, Frame, FrameError, Header, MachineInfo};
use isbell_proto::identity::{Identity, Role};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Relay close code for a gateway replaced by a newer connection for the same machine.
const CLOSE_REPLACED: u16 = 4001;
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    #[error("invalid relay url {0:?}: expected ws:// or wss://")]
    Url(String),
    #[error("relay connection failed: {0}")]
    Io(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("relay announced origin {got:?}, expected {expected:?}; refusing to sign")]
    OriginMismatch { expected: String, got: String },
    #[error("unexpected message from relay: {0}")]
    Protocol(String),
    #[error("relay rejected authentication (close code {0})")]
    Rejected(u16),
    #[error("another gateway is running with this machine's config")]
    Replaced,
    #[error("relay closed the connection (code {0:?})")]
    Closed(Option<u16>),
    #[error("relay connection idle for too long")]
    Idle,
}

impl From<FrameError> for RelayError {
    fn from(err: FrameError) -> Self {
        RelayError::Protocol(err.to_string())
    }
}

pub struct RelayConn {
    pub sid: String,
    pub conn: String,
    pub sink: FrameSink,
    pub stream: FrameStream,
}

pub struct FrameSink(SplitSink<Ws, Message>);
pub struct FrameStream(SplitStream<Ws>);

/// Connects and authenticates; a `machine` makes this a gateway connection.
pub async fn connect(
    url: &str,
    id: &Identity,
    machine: Option<MachineInfo>,
) -> Result<RelayConn, RelayError> {
    let expected = origin_of(url).ok_or_else(|| RelayError::Url(url.to_owned()))?;
    let (ws, _) = connect_async(url).await?;
    let (sink, stream) = ws.split();
    let (mut sink, mut stream) = (FrameSink(sink), FrameStream(stream));

    let Header::Challenge { nonce, origin } = stream.next(AUTH_TIMEOUT).await?.header else {
        return Err(RelayError::Protocol("expected challenge".into()));
    };
    if origin != expected {
        return Err(RelayError::OriginMismatch {
            expected,
            got: origin,
        });
    }
    let role = if machine.is_some() {
        Role::Gateway
    } else {
        Role::Client
    };
    let auth = Header::Auth {
        role,
        pk: id.public_key(),
        sig: id.sign_auth(role, &origin, &nonce),
        machine,
    };
    sink.send(&Frame::new(auth)).await?;

    match stream.next(AUTH_TIMEOUT).await {
        Ok(Frame {
            header: Header::AuthOk { sid, conn },
            ..
        }) => Ok(RelayConn {
            sid,
            conn,
            sink,
            stream,
        }),
        Ok(_) => Err(RelayError::Protocol("expected auth_ok".into())),
        Err(RelayError::Closed(Some(code))) if code != CLOSE_REPLACED => {
            Err(RelayError::Rejected(code))
        }
        Err(err) => Err(err),
    }
}

impl FrameSink {
    pub async fn send(&mut self, frame: &Frame) -> Result<(), RelayError> {
        let msg = match frame.encode() {
            Encoded::Text(text) => Message::Text(text.into()),
            Encoded::Binary(bytes) => Message::Binary(bytes.into()),
        };
        Ok(self.0.send(msg).await?)
    }
}

impl FrameStream {
    /// Next frame; fails with `Idle` when nothing (not even a ping) arrives within `idle`.
    pub async fn next(&mut self, idle: Duration) -> Result<Frame, RelayError> {
        loop {
            let msg = tokio::time::timeout(idle, self.0.next())
                .await
                .map_err(|_| RelayError::Idle)?
                .ok_or(RelayError::Closed(None))??;
            match msg {
                Message::Text(text) => return Ok(Frame::decode(text.as_bytes(), false)?),
                Message::Binary(bytes) => return Ok(Frame::decode(&bytes, true)?),
                Message::Close(frame) => {
                    let code = frame.map(|f| u16::from(f.code));
                    return Err(match code {
                        Some(CLOSE_REPLACED) => RelayError::Replaced,
                        code => RelayError::Closed(code),
                    });
                }
                Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
            }
        }
    }
}

/// `scheme://host[:port]` of a ws/wss URL, as the relay signs it into its challenge.
pub fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "ws" && scheme != "wss" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    (!authority.is_empty()).then(|| format!("{scheme}://{}", authority.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::origin_of;

    #[test]
    fn origin_keeps_scheme_host_and_port_only() {
        assert_eq!(
            origin_of("wss://isbell.upivot.io/v1/ws").as_deref(),
            Some("wss://isbell.upivot.io")
        );
        assert_eq!(
            origin_of("ws://localhost:8787/v1/ws?x=1").as_deref(),
            Some("ws://localhost:8787")
        );
        assert_eq!(
            origin_of("WSS://Example.COM").as_deref(),
            Some("wss://example.com")
        );
        assert_eq!(origin_of("https://example.com/v1/ws"), None);
        assert_eq!(origin_of("ws:///v1/ws"), None);
    }
}
