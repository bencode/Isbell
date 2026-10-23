//! What the client does with its relay connection: frames from the relay update the space and
//! answer the calls in flight; frames from callers go out in order. A direct link only answers
//! calls in flight (`to_inflight`).

use std::sync::{Arc, Mutex};

use isbell_proto::frame::{DataKind, Frame, Header, RpcError};
use isbell_proto::state::MachineState;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc};

use super::SessionEvent;
use super::inflight::{Inflight, Reply, Target, restarted};
use super::space::Space;
use super::stream::StreamEvent;
use crate::relay::{FrameSink, FrameStream, RELAY_IDLE};

pub async fn write_loop(mut sink: FrameSink, mut out: mpsc::UnboundedReceiver<Frame>) {
    while let Some(frame) = out.recv().await {
        if let Err(err) = sink.send(&frame).await {
            tracing::debug!(%err, "relay write failed");
            break;
        }
    }
}

/// What a frame from the relay means to the client.
#[derive(Debug)]
enum Inbound {
    Reply { id: u64, reply: Reply },
    Stream { id: u64, event: StreamEvent, last: bool },
    State(Box<MachineState>),
    Presence { mid: String, online: bool },
    Unreadable(String),
    Ignore,
}

fn inbound(frame: Frame) -> Inbound {
    match frame.header {
        Header::Res { id, ok, r, e, .. } => {
            let reply = match ok {
                true => Ok(r.unwrap_or(Value::Null)),
                false => Err(e.unwrap_or_else(|| RpcError::new("error", ""))),
            };
            Inbound::Reply { id, reply }
        }
        Header::Data { id, k: DataKind::Frame, full, .. } => {
            let body = frame.body.unwrap_or_default();
            Inbound::Stream {
                id,
                event: StreamEvent::Frame { body, full: full.unwrap_or(false) },
                last: false,
            }
        }
        Header::Data { id, k: DataKind::Chunk, .. } => {
            let event = StreamEvent::Chunk(frame.body.unwrap_or_default());
            Inbound::Stream { id, event, last: false }
        }
        Header::Credit { id, n, .. } => {
            Inbound::Stream { id, event: StreamEvent::Credit(n), last: false }
        }
        Header::End { id, e, .. } => Inbound::Stream { id, event: StreamEvent::End(e), last: true },
        Header::State { state } => match serde_json::from_value(state) {
            Ok(state) => Inbound::State(Box::new(state)),
            Err(err) => Inbound::Unreadable(err.to_string()),
        },
        Header::Presence { mid, online } => Inbound::Presence { mid, online },
        _ => Inbound::Ignore,
    }
}

pub async fn read_loop(
    mut stream: FrameStream,
    space: Arc<Mutex<Space>>,
    inflight: Inflight,
    events: broadcast::Sender<SessionEvent>,
) {
    let err = loop {
        match stream.next(RELAY_IDLE).await {
            Ok(frame) => {
                if let Some(event) = apply(inbound(frame), &space, &inflight) {
                    publish(&events, event);
                }
            }
            Err(err) => break err,
        }
    };
    tracing::debug!(%err, "relay session ended");
    inflight.close();
    publish(&events, SessionEvent::Closed);
}

/// Applies one frame to the calls in flight and the space; the event it makes, if any.
fn apply(inbound: Inbound, space: &Mutex<Space>, inflight: &Inflight) -> Option<SessionEvent> {
    match inbound {
        Inbound::Reply { id, reply } => {
            inflight.resolve(id, reply);
            None
        }
        Inbound::Stream { id, event, last } => {
            inflight.deliver(id, event, last);
            None
        }
        Inbound::State(state) => {
            let mid = &state.machine.id;
            let lost = |t: &Target| t.mid == *mid && restarted(t.boot, state.boot);
            inflight.fail(offline("machine restarted before answering"), lost);
            let recorded = space.lock().expect("session poisoned").record((*state).clone());
            recorded.then_some(SessionEvent::State(state))
        }
        Inbound::Presence { mid, online } => {
            if !online {
                // The gateway is gone, and with it every call and stream it was serving.
                inflight.fail(offline("machine went offline before answering"), |t| t.mid == mid);
            }
            space.lock().expect("session poisoned").set_online(mid.clone(), online);
            Some(SessionEvent::Presence { mid, online })
        }
        Inbound::Unreadable(err) => {
            tracing::warn!(err, "ignoring unreadable machine state");
            None
        }
        Inbound::Ignore => None,
    }
}

/// Hands a frame from a direct link to the call or stream waiting for it.
pub fn to_inflight(frame: Frame, inflight: &Inflight) {
    match inbound(frame) {
        Inbound::Reply { id, reply } => inflight.resolve(id, reply),
        Inbound::Stream { id, event, last } => inflight.deliver(id, event, last),
        other => tracing::debug!(?other, "ignoring a frame a direct link does not carry"),
    }
}

fn offline(reason: &str) -> RpcError {
    RpcError::new("machine_offline", reason)
}

fn publish(events: &broadcast::Sender<SessionEvent>, event: SessionEvent) {
    if events.send(event).is_err() {
        tracing::trace!("no event listeners");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn res(ok: bool, r: Option<Value>, e: Option<RpcError>) -> Frame {
        Frame::new(Header::Res { id: 1, ok, r, e, mid: Some("m".into()), to: None })
    }

    #[test]
    fn maps_responses() {
        assert!(
            matches!(inbound(res(true, Some(json!(1)), None)), Inbound::Reply { id: 1, reply: Ok(v) } if v == 1)
        );
        assert!(matches!(
            inbound(res(true, None, None)),
            Inbound::Reply { reply: Ok(Value::Null), .. }
        ));
        let err = RpcError::new("busy", "x");
        assert!(
            matches!(inbound(res(false, None, Some(err))), Inbound::Reply { reply: Err(e), .. } if e.code == "busy")
        );
        assert!(
            matches!(inbound(res(false, None, None)), Inbound::Reply { reply: Err(e), .. } if e.code == "error")
        );
    }

    #[test]
    fn maps_stream_frames() {
        let data = |k| Header::Data {
            id: 2,
            k,
            full: Some(true),
            cols: None,
            rows: None,
            mid: None,
            from: None,
            to: None,
        };
        let frame = inbound(Frame { header: data(DataKind::Frame), body: Some(b"hi".to_vec()) });
        assert!(
            matches!(frame, Inbound::Stream { id: 2, event: StreamEvent::Frame { ref body, full: true }, last: false } if body == b"hi")
        );
        assert!(matches!(inbound(Frame::new(data(DataKind::Input))), Inbound::Ignore));
        let end = Header::End { id: 2, e: None, mid: None, from: None, to: None };
        assert!(matches!(
            inbound(Frame::new(end)),
            Inbound::Stream { id: 2, event: StreamEvent::End(None), last: true }
        ));
        let chunk = inbound(Frame { header: data(DataKind::Chunk), body: Some(b"part".to_vec()) });
        assert!(
            matches!(chunk, Inbound::Stream { event: StreamEvent::Chunk(ref b), last: false, .. } if b == b"part")
        );
        let credit = Header::Credit { id: 2, n: 64, mid: None, from: None, to: None };
        assert!(matches!(
            inbound(Frame::new(credit)),
            Inbound::Stream { id: 2, event: StreamEvent::Credit(64), last: false }
        ));
    }

    #[test]
    fn maps_state_and_presence() {
        let state = Header::State { state: json!({"machine": "broken"}) };
        assert!(matches!(inbound(Frame::new(state)), Inbound::Unreadable(_)));
        let presence = Header::Presence { mid: "m".into(), online: false };
        assert!(matches!(inbound(Frame::new(presence)), Inbound::Presence { online: false, .. }));
        assert!(matches!(
            inbound(Frame::new(Header::Snapshot { machines: vec![] })),
            Inbound::Ignore
        ));
    }
}
