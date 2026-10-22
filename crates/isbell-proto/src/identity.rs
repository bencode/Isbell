//! Space identity.
//!
//! A space is identified by a 16-byte secret. Everything else is derived from it:
//!
//! ```text
//! key string = "isbk1-" ‖ base32lower(secret ‖ sha256(secret)[0..2])
//! seed       = HKDF-SHA256(ikm = secret, salt = ∅, info = "isbell-ed25519-v1", L = 32)
//! (sk, pk)   = Ed25519(seed)
//! sid        = base32lower(sha256(pk))[0..16]
//! ```
//!
//! The private key only signs the relay's auth challenge; the relay verifies and stores nothing.

use data_encoding::{BASE32_NOPAD, BASE64URL_NOPAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const KEY_PREFIX: &str = "isbk1-";
const SECRET_LEN: usize = 16;
const CHECKSUM_LEN: usize = 2;
const SEED_INFO: &[u8] = b"isbell-ed25519-v1";
const AUTH_DOMAIN: &str = "isbell-auth-v1";
const SID_LEN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Gateway,
    Client,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Gateway => "gateway",
            Role::Client => "client",
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum IdentityError {
    #[error("key must start with \"{KEY_PREFIX}\"")]
    Prefix,
    #[error("key is not valid base32 of the expected length")]
    Encoding,
    #[error("key checksum mismatch")]
    Checksum,
}

pub struct Identity {
    secret: [u8; SECRET_LEN],
    signing: SigningKey,
}

impl Identity {
    pub fn generate() -> Self {
        Self::from_secret(rand::random())
    }

    pub fn parse(key: &str) -> Result<Self, IdentityError> {
        let encoded = key
            .trim()
            .strip_prefix(KEY_PREFIX)
            .ok_or(IdentityError::Prefix)?;
        let bytes = BASE32_NOPAD
            .decode(encoded.to_ascii_uppercase().as_bytes())
            .map_err(|_| IdentityError::Encoding)?;
        let (secret, checksum) = bytes
            .split_first_chunk::<SECRET_LEN>()
            .filter(|(_, rest)| rest.len() == CHECKSUM_LEN)
            .ok_or(IdentityError::Encoding)?;
        if checksum != &Sha256::digest(secret)[..CHECKSUM_LEN] {
            return Err(IdentityError::Checksum);
        }
        Ok(Self::from_secret(*secret))
    }

    fn from_secret(secret: [u8; SECRET_LEN]) -> Self {
        let mut seed = [0u8; 32];
        Hkdf::<Sha256>::new(None, &secret)
            .expand(SEED_INFO, &mut seed)
            .expect("32 bytes is a valid HKDF-SHA256 output length");
        Self {
            secret,
            signing: SigningKey::from_bytes(&seed),
        }
    }

    pub fn key_string(&self) -> String {
        let bytes = [
            &self.secret[..],
            &Sha256::digest(self.secret)[..CHECKSUM_LEN],
        ]
        .concat();
        format!(
            "{KEY_PREFIX}{}",
            BASE32_NOPAD.encode(&bytes).to_ascii_lowercase()
        )
    }

    pub fn public_key(&self) -> String {
        BASE64URL_NOPAD.encode(self.signing.verifying_key().as_bytes())
    }

    pub fn sid(&self) -> String {
        sid_of(&self.signing.verifying_key())
    }

    pub fn sign_auth(&self, role: Role, origin: &str, nonce: &str) -> String {
        let sig = self.signing.sign(&auth_message(role, origin, nonce));
        BASE64URL_NOPAD.encode(&sig.to_bytes())
    }
}

/// Verifies a challenge signature; returns the space id on success.
pub fn verify_auth(pk: &str, sig: &str, role: Role, origin: &str, nonce: &str) -> Option<String> {
    let pk: [u8; 32] = BASE64URL_NOPAD
        .decode(pk.as_bytes())
        .ok()?
        .try_into()
        .ok()?;
    let sig: [u8; 64] = BASE64URL_NOPAD
        .decode(sig.as_bytes())
        .ok()?
        .try_into()
        .ok()?;
    let key = VerifyingKey::from_bytes(&pk).ok()?;
    key.verify(
        &auth_message(role, origin, nonce),
        &Signature::from_bytes(&sig),
    )
    .ok()?;
    Some(sid_of(&key))
}

fn sid_of(key: &VerifyingKey) -> String {
    let encoded = BASE32_NOPAD.encode(&Sha256::digest(key.as_bytes()));
    encoded[..SID_LEN].to_ascii_lowercase()
}

fn auth_message(role: Role, origin: &str, nonce: &str) -> Vec<u8> {
    format!("{AUTH_DOMAIN}\n{}\n{origin}\n{nonce}", role.as_str()).into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "wss://isbell.upivot.io";
    const NONCE: &str = "bm9uY2UtZm9yLXRlc3Rz";

    fn known() -> Identity {
        Identity::from_secret(core::array::from_fn(|i| i as u8))
    }

    #[test]
    fn derivation_matches_known_answers() {
        let id = known();
        assert_eq!(id.key_string(), KNOWN_KEY);
        assert_eq!(id.public_key(), KNOWN_PK);
        assert_eq!(id.sid(), KNOWN_SID);
        assert_eq!(id.sign_auth(Role::Client, ORIGIN, NONCE), KNOWN_SIG);
    }

    #[test]
    fn parse_round_trips() {
        let id = Identity::generate();
        let parsed = Identity::parse(&id.key_string()).unwrap();
        assert_eq!(parsed.public_key(), id.public_key());
        assert_eq!(parsed.key_string().len(), KEY_PREFIX.len() + 29);
    }

    #[test]
    fn parse_rejects_bad_keys() {
        let key = known().key_string();
        assert_eq!(
            Identity::parse(&key.replace("isbk1-", "isbk2-")).err(),
            Some(IdentityError::Prefix)
        );
        assert_eq!(
            Identity::parse(&key[..key.len() - 3]).err(),
            Some(IdentityError::Encoding)
        );
        let last = key.chars().last().unwrap();
        let flipped = format!(
            "{}{}",
            &key[..key.len() - 1],
            if last == 'a' { 'b' } else { 'a' }
        );
        assert!(Identity::parse(&flipped).is_err());
        let mut tampered = key.clone().into_bytes();
        tampered[KEY_PREFIX.len()] = if tampered[KEY_PREFIX.len()] == b'a' {
            b'b'
        } else {
            b'a'
        };
        assert_eq!(
            Identity::parse(&String::from_utf8(tampered).unwrap()).err(),
            Some(IdentityError::Checksum)
        );
    }

    #[test]
    fn verify_accepts_only_the_signed_context() {
        let id = known();
        let sig = id.sign_auth(Role::Gateway, ORIGIN, NONCE);
        let pk = id.public_key();
        assert_eq!(
            verify_auth(&pk, &sig, Role::Gateway, ORIGIN, NONCE),
            Some(id.sid())
        );
        assert_eq!(verify_auth(&pk, &sig, Role::Client, ORIGIN, NONCE), None);
        assert_eq!(
            verify_auth(&pk, &sig, Role::Gateway, "wss://evil.example", NONCE),
            None
        );
        assert_eq!(verify_auth(&pk, &sig, Role::Gateway, ORIGIN, "other"), None);
    }

    #[test]
    fn verify_rejects_malformed_input() {
        let id = known();
        let sig = id.sign_auth(Role::Client, ORIGIN, NONCE);
        assert_eq!(
            verify_auth("not base64!", &sig, Role::Client, ORIGIN, NONCE),
            None
        );
        assert_eq!(
            verify_auth(&id.public_key(), "AAAA", Role::Client, ORIGIN, NONCE),
            None
        );
        assert_eq!(verify_auth("AAAA", &sig, Role::Client, ORIGIN, NONCE), None);
    }

    // Secret = bytes 0..16. Cross-checked once against node:crypto (HKDF, Ed25519, RFC 4648 base32).
    const KNOWN_KEY: &str = "isbk1-aaaqeayeaudaocajbifqydiob67ek";
    const KNOWN_PK: &str = "YOEwttMk7-tHb28Otm_aioL8puHqgQDQ-xJtOdRcgmY";
    const KNOWN_SID: &str = "pejdvpwc5znsf34o";
    const KNOWN_SIG: &str =
        "oz9VvjxNbYBp8Ap-RCnLkC4hh5Po78ln8F5LPVZLwL7e8gmNdZDhH_vizs-p77H5eIbf8JV3UksTayWAP7xqCA";
}
