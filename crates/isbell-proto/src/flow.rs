//! Flow control for streams (terminals and files alike). A stream's receiver grants its sender
//! credit in bytes, so a fast sender never gets more than a window ahead of a slow receiver,
//! whichever transport is in between. The relay does not do this for them: it only bounds what
//! waits for each connection, and closes a connection that falls further behind.
//!
//! ```text
//! receiver ─▶ credit(WINDOW)          after opening the stream
//! sender   ─▶ data … up to the credit, then waits
//! receiver ─▶ credit(n)               once it consumed n ≥ WINDOW / 2 more bytes
//! ```

/// Largest data frame, so every link carries it as one message (a WebRTC DataChannel message).
/// Other frames may be larger: the relay link takes state and snapshots up to 1 MiB.
pub const MAX_DATA_MESSAGE: usize = 64 * 1024;
/// Largest data body; the rest of `MAX_DATA_MESSAGE` is room for the frame header.
pub const MAX_CHUNK: usize = 63 * 1024;
/// Bytes a receiver lets in before it must grant more.
pub const WINDOW: u64 = 1 << 20;

/// Sender side: bytes it may still send.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Credit(u64);

impl Credit {
    pub fn granted(self, n: u64) -> Credit {
        Credit(self.0.saturating_add(n))
    }

    pub fn spent(self, len: u64) -> Credit {
        Credit(self.0.saturating_sub(len))
    }

    pub fn available(self) -> u64 {
        self.0
    }
}

/// Receiver side: bytes consumed since its last grant.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Grants(u64);

impl Grants {
    /// Grants back what was consumed once it reaches half a window.
    pub fn consumed(self, len: u64) -> (Grants, Option<u64>) {
        let pending = self.0 + len;
        match pending >= WINDOW / 2 {
            true => (Grants(0), Some(pending)),
            false => (Grants(pending), None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{DataKind, Frame, Header};

    #[test]
    fn credit_never_goes_negative_or_overflows() {
        let credit = Credit::default().granted(100).spent(30);
        assert_eq!(credit.available(), 70);
        assert_eq!(credit.spent(500).available(), 0);
        assert_eq!(Credit::default().granted(u64::MAX).granted(1).available(), u64::MAX);
    }

    #[test]
    fn grants_what_was_consumed_every_half_window() {
        let chunk = WINDOW / 16;
        let seven = (0..7)
            .try_fold(Grants::default(), |grants, _| match grants.consumed(chunk) {
                (grants, None) => Some(grants),
                (_, Some(_)) => None,
            })
            .expect("seven chunks are less than half a window");
        assert_eq!(seven.consumed(chunk), (Grants::default(), Some(WINDOW / 2)));
    }

    #[test]
    fn the_largest_data_frame_fits_one_message() {
        let long = Some("x".repeat(64));
        let header = Header::Data {
            id: u64::MAX,
            k: DataKind::Frame,
            full: Some(false),
            cols: Some(u16::MAX),
            rows: Some(u16::MAX),
            mid: long.clone(),
            from: long.clone(),
            to: long,
        };
        let frame = Frame { header, body: Some(vec![0; MAX_CHUNK]) };
        assert!(frame.encode_binary().len() <= MAX_DATA_MESSAGE);
    }
}
