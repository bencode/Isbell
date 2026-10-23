//! Frames shared by every transport: the relay WebSocket and WebRTC DataChannels.
//!
//! Routing fields are only present on relay hops:
//! client → relay carries `mid`; relay → gateway carries `from`;
//! gateway → relay carries `to`; relay → client carries `mid`.

mod codec;
mod header;

pub use codec::{Encoded, Frame, FrameError};
pub use header::{DataKind, Header, Route, RpcError, SnapshotEntry};

/// Close codes the relay ends a WebSocket with; clients act on them (a replaced gateway stops
/// instead of reconnecting).
pub const CLOSE_REPLACED: u16 = 4001;
pub const CLOSE_AUTH_FAILED: u16 = 4003;
pub const CLOSE_AUTH_TIMEOUT: u16 = 4004;
pub const CLOSE_TOO_SLOW: u16 = 4008;
pub const CLOSE_BAD_FRAME: u16 = 4400;
