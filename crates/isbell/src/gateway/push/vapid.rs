//! The key a gateway signs its pushes with (VAPID), derived from the space key, so every machine in
//! the space signs with the same one and nothing is configured or applied for:
//!
//! ```text
//! seed(n) = HKDF-SHA256(ikm = key string, salt = ∅, info = "isbell-vapid-p256-v1" ‖ n, L = 32)
//! key     = the P-256 private key seed(n), for the first n = 0, 1, … that is one
//! ```
//!
//! A new space key gives a new VAPID key: the phones subscribed under the old one subscribe again
//! the next time Isbell opens on them.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hkdf::Hkdf;
use isbell_proto::identity::Identity;
use sha2::Sha256;
use web_push_native::jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair};

const INFO: &[u8] = b"isbell-vapid-p256-v1";

pub fn derive(identity: &Identity) -> ES256KeyPair {
    let key = identity.key_string();
    // A seed is not a private key only when it is 0 or past the curve's order: about 2⁻³² of them.
    (0..=u8::MAX)
        .find_map(|n| {
            let mut seed = [0u8; 32];
            Hkdf::<Sha256>::new(None, key.as_bytes())
                .expand(&[INFO, &[n]].concat(), &mut seed)
                .expect("32 bytes is a valid HKDF-SHA256 output length");
            ES256KeyPair::from_bytes(&seed).ok()
        })
        .expect("one of 256 seeds is a P-256 private key")
}

/// The public key a phone subscribes with: the uncompressed point, base64url without padding.
pub fn public_key(pair: &ES256KeyPair) -> String {
    URL_SAFE_NO_PAD.encode(pair.public_key().public_key().to_bytes_uncompressed())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_space_signs_with_one_key_on_every_machine() {
        let identity = Identity::generate();
        let again = Identity::parse(&identity.key_string()).unwrap();
        let key = public_key(&derive(&identity));
        assert_eq!(key, public_key(&derive(&again)));
        let point = URL_SAFE_NO_PAD.decode(&key).unwrap();
        assert_eq!((point.len(), point[0]), (65, 0x04), "an uncompressed P-256 point");
        assert_ne!(key, public_key(&derive(&Identity::generate())), "another space, another key");
    }
}
