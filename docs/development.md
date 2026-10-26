# Development

- Rust (stable) and Docker for the relay and the CLI; Node 24 and pnpm 10 for the web app.
- Crates: `isbell-proto` (frames and identity, shared), `isbell` (gateway and CLI), `isbell-relay`.
- `web/` is the web app; how its source is layered: [web/ARCHITECTURE.md](../web/ARCHITECTURE.md).

## Relay

```bash
docker compose up -d redis     # Redis without persistence, used by the relay
cargo run -p isbell-relay      # relay on 0.0.0.0:8787 (GET /healthz, WebSocket /v1/ws)
```

- The relay exits when its Redis pub/sub connection is lost; run it under a supervisor that
  restarts it.

| Variable | Default |
|---|---|
| `BIND` | `0.0.0.0:8787` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `PUBLIC_ORIGIN` | `ws://localhost:8787` |
| `TRUST_PROXY` | unset (`1` to use the last `x-forwarded-for` hop, the one added by the reverse proxy) |
| `LIMIT_IP_CONCURRENT` / `LIMIT_IP_PER_MINUTE` | `20` / `30` |
| `LIMIT_RATE` / `LIMIT_BURST` | `50` / `100` messages per client connection; beyond it clients get `rate_limited` |
| `LIMIT_GATEWAY_BYTES_PER_SEC` / `LIMIT_GATEWAY_BURST_BYTES` | 8 MiB / 16 MiB per gateway connection; beyond it the relay reads more slowly (frames are never dropped) |
| `LIMIT_INBOX_FRAMES` | `1024` messages waiting for one connection; a connection further behind is closed as too slow (code 4008) |

## Gateway and CLI

Against a local relay and this machine's herdr server:

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
| `ISBELL_RELAY` | Relay URL (default `wss://isbell.fmap.dev/v1/ws`) |
| `ISBELL_KEY` | Space key, instead of this machine's key file |
| `ISBELL_CONFIG_DIR` | Config directory (default `~/.config/isbell`); a second directory simulates a second machine |
| `ISBELL_HERDR_SOCKET` | Use this herdr socket instead of discovering it with `herdr status` |
| `ISBELL_HERDR_BIN` | herdr executable the gateway runs (default `herdr` on `PATH`) |

- Agents started through herdr inherit the herdr server's environment and the pane's login shell,
  so settings such as `http_proxy` belong in the shell profile (e.g. `~/.zshrc`).

Checks (the relay and isbell integration tests need Redis running):

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

## Web

- React, Vite, Tailwind, Base UI. `src/model/` holds the protocol, the space connection, the
  project model and screen reading, with no React.
- The browser keeps the space key, settings and read marks in its own storage; nothing is stored
  on the relay.
- Calls and streams go over a WebRTC direct link to the machine when one can be opened (the
  gateway's `isbell.rtc.offer`, as the CLI uses it), otherwise over the relay. A frame too long
  for one DataChannel message goes in pieces (`isbell_proto::frame::pieces`, `src/model/pieces.ts`),
  which both ends agree to in the offer. The relay always carries the offer itself and the
  machines' state.
- `crates/isbell-proto/tests/vectors.json` is shared by the Rust and TypeScript tests, so both
  ends encode frames and sign identically.

```bash
cd web
pnpm install
pnpm dev                                               # workbench on http://localhost:5173
VITE_RELAY_URL=ws://localhost:8787/v1/ws pnpm dev      # against a local relay
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

## Releasing

- Bump `version` in the root `Cargo.toml`, commit, then push the tag `v<version>`.
- `.github/workflows/release.yml` builds isbell for Apple silicon and publishes the release that
  `install.sh` downloads; it fails when the tag and the version differ.
