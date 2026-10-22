//! Challenge–response authentication: the socket exchange, around a pure check.

use std::time::Duration;

use axum::extract::ws::WebSocket;
use data_encoding::BASE64URL_NOPAD;
use isbell_proto::frame::{Frame, Header};
use isbell_proto::identity::{Role, verify_auth};
use isbell_proto::state::MachineInfo;

use super::{CLOSE_AUTH_FAILED, CLOSE_AUTH_TIMEOUT, Exit, wire};

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_AUTH_FRAME: usize = 4096;

#[derive(Debug, PartialEq)]
pub struct Admitted {
    pub sid: String,
    pub role: Role,
    pub machine: Option<MachineInfo>,
}

/// Why authentication failed; logged, while the peer only sees "auth failed".
#[derive(Debug, PartialEq)]
pub enum AuthReject {
    TooLarge,
    NotAuth,
    BadSignature,
    /// A gateway without a valid machine, or a client with one.
    BadMachine,
}

pub async fn authenticate(socket: &mut WebSocket, origin: &str) -> Result<Admitted, Exit> {
    let nonce = BASE64URL_NOPAD.encode(&rand::random::<[u8; 16]>());
    let challenge = Header::Challenge { nonce: nonce.clone(), origin: origin.to_owned() };
    if let Err(err) = wire::send(socket, &Frame::new(challenge)).await {
        tracing::debug!(%err, "challenge not delivered");
        return Err(Exit::Closed);
    }
    let (data, binary) = tokio::time::timeout(AUTH_TIMEOUT, wire::recv_data(socket))
        .await
        .map_err(|_| Exit::Close(CLOSE_AUTH_TIMEOUT, "auth timeout"))?
        .ok_or(Exit::Closed)?;
    check_auth(&data, binary, origin, &nonce).map_err(|reject| {
        tracing::info!(?reject, "authentication rejected");
        Exit::Close(CLOSE_AUTH_FAILED, "auth failed")
    })
}

pub fn check_auth(
    data: &[u8],
    binary: bool,
    origin: &str,
    nonce: &str,
) -> Result<Admitted, AuthReject> {
    if data.len() > MAX_AUTH_FRAME {
        return Err(AuthReject::TooLarge);
    }
    let Ok(Frame { header: Header::Auth { role, pk, sig, machine }, .. }) =
        Frame::decode(data, binary)
    else {
        return Err(AuthReject::NotAuth);
    };
    let sid = verify_auth(&pk, &sig, role, origin, nonce).ok_or(AuthReject::BadSignature)?;
    let machine_ok = match role {
        Role::Gateway => machine.as_ref().is_some_and(MachineInfo::is_valid),
        Role::Client => machine.is_none(),
    };
    machine_ok.then_some(Admitted { sid, role, machine }).ok_or(AuthReject::BadMachine)
}

#[cfg(test)]
mod tests {
    use isbell_proto::identity::Identity;

    use super::*;

    const ORIGIN: &str = "wss://relay.test";
    const NONCE: &str = "nonce";

    fn auth(id: &Identity, role: Role, nonce: &str, machine: Option<MachineInfo>) -> Vec<u8> {
        let header = Header::Auth {
            role,
            pk: id.public_key(),
            sig: id.sign_auth(role, ORIGIN, nonce),
            machine,
        };
        Frame::new(header).encode_binary()
    }

    fn machine() -> MachineInfo {
        MachineInfo {
            id: "0123456789abcdef".into(),
            name: "m".into(),
            hostname: "h".into(),
            os: "macos".into(),
            version: "0".into(),
        }
    }

    #[test]
    fn admits_signed_gateways_and_clients() {
        let id = Identity::generate();
        let gateway =
            check_auth(&auth(&id, Role::Gateway, NONCE, Some(machine())), true, ORIGIN, NONCE)
                .unwrap();
        assert_eq!((gateway.sid.as_str(), gateway.role), (id.sid().as_str(), Role::Gateway));
        assert_eq!(
            check_auth(&auth(&id, Role::Client, NONCE, None), true, ORIGIN, NONCE).unwrap().role,
            Role::Client
        );
    }

    #[test]
    fn names_each_rejection() {
        let id = Identity::generate();
        let check = |data: Vec<u8>| check_auth(&data, true, ORIGIN, NONCE).unwrap_err();
        assert_eq!(check(vec![0; MAX_AUTH_FRAME + 1]), AuthReject::TooLarge);
        assert_eq!(
            check(Frame::new(Header::Presence { mid: "m".into(), online: true }).encode_binary()),
            AuthReject::NotAuth
        );
        assert_eq!(check(auth(&id, Role::Client, "other nonce", None)), AuthReject::BadSignature);
        assert_eq!(check(auth(&id, Role::Gateway, NONCE, None)), AuthReject::BadMachine);
        assert_eq!(check(auth(&id, Role::Client, NONCE, Some(machine()))), AuthReject::BadMachine);
    }
}
