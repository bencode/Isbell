//! How much a client may send. Changes only when the rate-limit policy changes.

use std::collections::HashSet;
use std::time::Instant;

use crate::limits::TokenBucket;

/// Streams the relay ended for a rate-limited client; their later frames are dropped.
const MAX_ENDED_STREAMS: usize = 1024;

/// A client's message budget and the streams it lost to the limit, as a value.
pub struct ClientLimiter {
    bucket: TokenBucket,
    ended: HashSet<u64>,
}

#[derive(Debug, PartialEq)]
pub enum Admission {
    Forward,
    /// Answer the call with `rate_limited`.
    RejectCall,
    /// End the stream on both sides: the client is told, the gateway frees it.
    EndStream,
    /// A frame of a stream already ended by the relay.
    Drop,
    /// Over the limit with too many ended streams to track: drop without telling anyone.
    DropUnnoticed,
}

impl ClientLimiter {
    pub fn new(rate: f64, burst: f64, now: Instant) -> Self {
        Self {
            bucket: TokenBucket::new(rate, burst, now),
            ended: HashSet::new(),
        }
    }

    pub fn admit(self, id: u64, is_call: bool, now: Instant) -> (Self, Admission) {
        if !is_call && self.ended.contains(&id) {
            return (self, Admission::Drop);
        }
        let (bucket, allowed) = self.bucket.try_take(1.0, now);
        let ended = self.ended;
        match (allowed, is_call) {
            (true, _) => (Self { bucket, ended }, Admission::Forward),
            (false, true) => (Self { bucket, ended }, Admission::RejectCall),
            (false, false) if ended.len() >= MAX_ENDED_STREAMS => {
                (Self { bucket, ended }, Admission::DropUnnoticed)
            }
            (false, false) => {
                let ended = ended.into_iter().chain([id]).collect();
                (Self { bucket, ended }, Admission::EndStream)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admit_all(
        limiter: ClientLimiter,
        frames: &[(u64, bool)],
        now: Instant,
    ) -> (ClientLimiter, Vec<Admission>) {
        frames.iter().fold(
            (limiter, Vec::new()),
            |(limiter, admitted), &(id, is_call)| {
                let (limiter, admission) = limiter.admit(id, is_call, now);
                (limiter, admitted.into_iter().chain([admission]).collect())
            },
        )
    }

    #[test]
    fn over_the_limit_calls_are_rejected_and_streams_ended_once() {
        let now = Instant::now();
        let limiter = ClientLimiter::new(0.0, 2.0, now);
        let (_, admitted) = admit_all(
            limiter,
            &[
                (1, true),
                (2, false),
                (3, true),
                (2, false),
                (4, false),
                (4, false),
            ],
            now,
        );
        use Admission::*;
        assert_eq!(
            admitted,
            [Forward, Forward, RejectCall, EndStream, EndStream, Drop]
        );
    }

    #[test]
    fn stops_tracking_ended_streams_at_the_cap() {
        let now = Instant::now();
        let ended = (0..MAX_ENDED_STREAMS as u64).collect();
        let limiter = ClientLimiter {
            bucket: TokenBucket::new(0.0, 0.0, now),
            ended,
        };
        assert_eq!(
            limiter.admit(u64::MAX, false, now).1,
            Admission::DropUnnoticed
        );
    }
}
