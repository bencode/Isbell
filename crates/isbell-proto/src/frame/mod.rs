//! Frames shared by every transport (relay WebSocket and, later, WebRTC DataChannel).
//!
//! Routing fields are only present on relay hops:
//! client → relay carries `mid`; relay → gateway carries `from`;
//! gateway → relay carries `to`; relay → client carries `mid`.

mod codec;
mod header;

pub use codec::{Encoded, Frame, FrameError};
pub use header::{DataKind, Header, Route, RpcError, SnapshotEntry};
