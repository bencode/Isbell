//! Frames too long for one DataChannel message, sent on a direct link as a run of pieces.
//!
//! ```text
//! message = frame | piece
//! piece   = u32be(0xFFFF_FFFF) ‖ u8(last) ‖ bytes     the next bytes of a frame's binary encoding
//! ```
//!
//! A frame's binary encoding starts with its header length, which is never `0xFFFF_FFFF`, so a
//! piece never passes for a frame. The channel is ordered and each side writes from one place, so a
//! frame's pieces arrive back to back.

use super::{Frame, FrameError};
use crate::flow::MAX_DATA_MESSAGE;

/// Longest message a sender puts on the channel; browsers take up to 256 KiB.
pub const PIECE: usize = MAX_DATA_MESSAGE;
/// Longest frame a receiver puts back together; herdr answers with at most 4 MiB.
pub const MAX_ASSEMBLED: usize = 16 << 20;

const MARK: [u8; 4] = [0xFF; 4];
/// The mark and the `last` byte.
const HEAD: usize = MARK.len() + 1;

/// A frame's binary encoding as messages of at most `size` bytes: itself when it fits, else its
/// pieces.
pub fn split(encoded: Vec<u8>, size: usize) -> Vec<Vec<u8>> {
    if encoded.len() <= size {
        return vec![encoded];
    }
    let chunks: Vec<&[u8]> = encoded.chunks(size - HEAD).collect();
    let n = chunks.len();
    chunks
        .iter()
        .enumerate()
        .map(|(i, bytes)| [&MARK[..], &[u8::from(i + 1 == n)], bytes].concat())
        .collect()
}

/// Puts frames back together from the messages of a channel, pieces or whole.
#[derive(Default)]
pub struct Assembler {
    /// The pieces so far of the frame being put together.
    held: Vec<u8>,
    /// The rest of a frame that went over `MAX_ASSEMBLED` is dropped up to its last piece.
    skipping: bool,
}

impl Assembler {
    /// The frame `msg` completes, or `None` while its pieces keep coming. After an error the next
    /// whole frame decodes again.
    pub fn push(&mut self, msg: &[u8], binary: bool) -> Result<Option<Frame>, FrameError> {
        // Shorter than a piece's head, it can only be a frame (or a broken one).
        let piece = if binary && msg.len() >= HEAD { msg.strip_prefix(&MARK[..]) } else { None };
        let Some(piece) = piece else {
            if !self.held.is_empty() || self.skipping {
                *self = Assembler::default();
                return Err(FrameError::Interrupted);
            }
            return Frame::decode(msg, binary).map(Some);
        };
        let (last, bytes) = (piece[0] != 0, &piece[1..]);
        if self.skipping {
            self.skipping = !last;
            return Ok(None);
        }
        if self.held.len() + bytes.len() > MAX_ASSEMBLED {
            *self = Assembler { held: Vec::new(), skipping: !last };
            return Err(FrameError::TooLarge(MAX_ASSEMBLED));
        }
        self.held.extend_from_slice(bytes);
        if !last {
            return Ok(None);
        }
        Frame::decode(&std::mem::take(&mut self.held), true).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{DataKind, Header};

    fn data(id: u64, body: Vec<u8>) -> Frame {
        let header = Header::Data {
            id,
            k: DataKind::Frame,
            full: None,
            cols: None,
            rows: None,
            mid: None,
            from: None,
            to: None,
        };
        Frame { header, body: Some(body) }
    }

    fn feed(asm: &mut Assembler, msgs: Vec<Vec<u8>>) -> Vec<Result<Option<Frame>, String>> {
        msgs.iter().map(|m| asm.push(m, true).map_err(|e| e.to_string())).collect()
    }

    #[test]
    fn a_long_frame_goes_in_pieces_and_comes_back_whole() {
        let frame = data(7, (0..1 << 20).map(|i| i as u8).collect());
        let msgs = split(frame.encode_binary(), PIECE);
        assert!(msgs.len() > 16 && msgs.iter().all(|m| m.len() <= PIECE));
        let mut asm = Assembler::default();
        let out = feed(&mut asm, msgs);
        assert!(out[..out.len() - 1].iter().all(|r| r == &Ok(None)));
        assert_eq!(out.last(), Some(&Ok(Some(frame))));
    }

    #[test]
    fn a_frame_that_fits_goes_whole() {
        let frame = data(1, vec![1; PIECE - 200]);
        let encoded = frame.encode_binary();
        assert!(encoded.len() <= PIECE);
        assert_eq!(split(encoded.clone(), PIECE), vec![encoded.clone()]);
        assert_eq!(Assembler::default().push(&encoded, true).unwrap(), Some(frame));
        // Exactly `size` long still goes whole.
        assert_eq!(split(encoded.clone(), encoded.len()).len(), 1);
    }

    #[test]
    fn a_frame_over_the_cap_is_dropped_and_the_next_one_still_decodes() {
        let big = data(1, vec![0; MAX_ASSEMBLED + 1]);
        let small = data(2, vec![9; 3]);
        let mut asm = Assembler::default();
        let out = feed(&mut asm, split(big.encode_binary(), PIECE));
        assert_eq!(out.iter().filter(|r| r.is_err()).count(), 1);
        assert!(out.iter().all(|r| matches!(r, Ok(None) | Err(_))));
        assert_eq!(asm.push(&small.encode_binary(), true).unwrap(), Some(small));
    }

    #[test]
    fn a_whole_frame_amid_pieces_is_an_error_and_the_next_one_decodes() {
        let pieces = split(data(1, vec![5; 3 * PIECE]).encode_binary(), PIECE);
        let small = data(2, vec![1]);
        let mut asm = Assembler::default();
        assert_eq!(asm.push(&pieces[0], true).unwrap(), None);
        assert!(matches!(asm.push(&small.encode_binary(), true), Err(FrameError::Interrupted)));
        assert_eq!(asm.push(&small.encode_binary(), true).unwrap(), Some(small));
    }
}
