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

Try the gateway and CLI against a local relay and this machine's herdr server:

```bash
export ISBELL_RELAY=ws://localhost:8787/v1/ws
cargo run -p isbell -- space init
cargo run -p isbell -- gateway run &          # reports this machine's herdr agents
cargo run -p isbell -- machine list
cargo run -p isbell -- agent list
cargo run -p isbell -- agent prompt <machine>/<agent> "..." --wait
cargo run -p isbell -- watch                  # NDJSON presence and status changes
cargo run -p isbell -- terminal new <machine> --cwd '~/work'           # new shell, ctrl+] detaches
cargo run -p isbell -- terminal attach <machine>/<pane-or-agent>       # read-only
cargo run -p isbell -- terminal attach <machine>/<pane-or-agent> --control
```

| Variable | Purpose |
|---|---|
| `ISBELL_RELAY` | Relay URL (default `wss://isbell.upivot.io/v1/ws`) |
| `ISBELL_KEY` | Space key, instead of this machine's key file |
| `ISBELL_CONFIG_DIR` | Config directory (default `~/.config/isbell`); a second directory simulates a second machine |
| `ISBELL_HERDR_SOCKET` | Use this herdr socket instead of discovering it with `herdr status` |
| `ISBELL_HERDR_BIN` | herdr executable the gateway runs (default `herdr` on `PATH`) |

Agents started through herdr inherit the herdr server's environment and the pane's login shell,
so settings such as `http_proxy` belong in the shell profile (e.g. `~/.zshrc`).

Checks (the relay and isbell integration tests need Redis running):

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```
