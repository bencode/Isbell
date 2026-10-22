# Isbell

Remote access to [herdr](https://github.com/herdrdev/herdr) agents across your machines.

Status: early development.

## Development

Requirements: Rust (stable), Docker.

```bash
docker compose up -d redis     # Redis without persistence, used by the relay
cargo run -p isbell-relay      # relay on 0.0.0.0:8787 (GET /healthz, WebSocket /v1/ws)
```

The relay exits when its Redis pub/sub connection is lost; run it under a supervisor that restarts it.

Relay configuration (environment variables):

| Variable | Default |
|---|---|
| `BIND` | `0.0.0.0:8787` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `PUBLIC_ORIGIN` | `ws://localhost:8787` |
| `TRUST_PROXY` | unset (`1` to use the first `x-forwarded-for` hop) |
| `LIMIT_IP_CONCURRENT` / `LIMIT_IP_PER_MINUTE` | `20` / `30` |
| `LIMIT_RATE` / `LIMIT_BURST` | `50` / `100` messages per connection |

Checks (the relay integration tests need Redis running):

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```
