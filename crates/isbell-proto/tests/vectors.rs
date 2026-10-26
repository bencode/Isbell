//! The Rust side of `vectors.json`, which the TypeScript client checks too: if these pass, both
//! implementations agree on keys, the auth signature, frame bytes and pieces.

use data_encoding::HEXLOWER;
use isbell_proto::frame::pieces::{Assembler, split};
use isbell_proto::frame::{Encoded, Frame, Header};
use isbell_proto::identity::{Identity, IdentityError, Role};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("vectors.json")).expect("vectors.json is JSON")
}

fn str_at<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("{key} is a string"))
}

#[test]
fn identity_matches() {
    let v = &vectors()["identity"];
    let id = Identity::parse(str_at(v, "key")).expect("valid key");
    assert_eq!(id.key_string(), str_at(v, "key"));
    assert_eq!(id.public_key(), str_at(v, "pk"));
    assert_eq!(id.sid(), str_at(v, "sid"));
    assert_eq!(str_at(v, "role"), Role::Client.as_str());
    assert_eq!(
        id.sign_auth(Role::Client, str_at(v, "origin"), str_at(v, "nonce")),
        str_at(v, "sig")
    );
}

#[test]
fn bad_keys_are_rejected_for_the_stated_reason() {
    for case in vectors()["badKeys"].as_array().expect("badKeys is a list") {
        let expected = match str_at(case, "error") {
            "prefix" => IdentityError::Prefix,
            "encoding" => IdentityError::Encoding,
            "checksum" => IdentityError::Checksum,
            other => panic!("unknown error {other}"),
        };
        assert_eq!(Identity::parse(str_at(case, "key")).err(), Some(expected), "{case}");
    }
}

#[test]
fn frames_encode_to_the_stated_bytes() {
    for case in vectors()["frames"].as_array().expect("frames is a list") {
        let header: Header = serde_json::from_value(case["header"].clone()).expect("header");
        let body =
            case.get("bodyHex").map(|b| HEXLOWER.decode(b.as_str().unwrap().as_bytes()).unwrap());
        let frame = Frame { header, body };
        match (frame.encode(), case.get("text"), case.get("binaryHex")) {
            (Encoded::Text(text), Some(expected), None) => {
                assert_eq!(text, expected.as_str().unwrap())
            }
            (Encoded::Binary(bytes), None, Some(expected)) => {
                assert_eq!(HEXLOWER.encode(&bytes), expected.as_str().unwrap());
                assert_eq!(Frame::decode(&bytes, true).unwrap(), frame);
            }
            _ => panic!("wrong message kind for {case}"),
        }
    }
}

#[test]
fn pieces_split_to_the_stated_bytes_and_assemble_back() {
    let v = &vectors()["pieces"];
    let header: Header = serde_json::from_value(v["header"].clone()).expect("header");
    let body = HEXLOWER.decode(str_at(v, "bodyHex").as_bytes()).unwrap();
    let frame = Frame { header, body: Some(body) };
    let size = v["size"].as_u64().expect("size") as usize;
    let pieces = split(frame.encode_binary(), size);
    let hex: Vec<String> = pieces.iter().map(|p| HEXLOWER.encode(p)).collect();
    let expected: Vec<&str> =
        v["piecesHex"].as_array().unwrap().iter().map(|p| p.as_str().unwrap()).collect();
    assert_eq!(hex, expected);
    let mut asm = Assembler::default();
    let frames: Vec<Frame> = pieces.iter().filter_map(|p| asm.push(p, true).unwrap()).collect();
    assert_eq!(frames, vec![frame]);
}
