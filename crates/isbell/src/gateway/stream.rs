//! What flows on a stream between a caller and the gateway, whatever the stream serves
//! (a terminal, a file). Each kind of stream acts on the inputs it understands and ignores the rest.

use isbell_proto::frame::RpcError;

/// What a caller sends into a stream.
#[derive(Debug, PartialEq)]
pub enum Input {
    /// Keystrokes for a terminal.
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Ping,
    /// A piece of a byte stream (a file being written).
    Chunk(Vec<u8>),
    /// The caller can take `n` more bytes.
    Credit(u64),
    Close,
}

/// What a stream sends to its caller.
#[derive(Debug, PartialEq)]
pub enum Output {
    /// A terminal screen update.
    Frame {
        body: Vec<u8>,
        full: bool,
        cols: u16,
        rows: u16,
    },
    /// A piece of a byte stream (a file being read).
    Chunk(Vec<u8>),
    End(Option<RpcError>),
}
