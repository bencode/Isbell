# Isbell

Reach the AI agents on your own Macs from any browser. Isbell connects to
[herdr](https://github.com/herdrdev/herdr), the terminal workspace your agents (Codex, Claude Code,
…) run in.

**Open the app: <https://isbell.fmap.dev>**

![The board: two projects on one machine, a session asking and one working](docs/board.png)

Status: early development, on Macs with Apple silicon.

## Features

- **One board** for the sessions on all your machines; those asking you, or just done, come first.
- **Chat**: each session reads as turns; reply, or answer what the agent asks with one click.
- **Start and end**: a new agent session with its task, or a plain shell, on any machine.
- **Terminal**: watch or take over any pane, in the browser.
- **Notifications** when an agent asks or finishes, while Isbell is open in a tab; the tab title
  counts what needs you.
- **CLI**: the same from a terminal, plus copying files between machines (`isbell file get/put`).

## How it works

```text
+----------------------- relay server -------------------------+
|  relay <--> Redis: in memory only, every key expires         |
|  stores no user data, logs no message content                |
+-----^---------------------------------------------^----------+
      |                                             |
      | WSS: status,                                | WSS, dialled out
      | small calls                                 | by the gateway
      |                                             |
+-----+--------------+                 +------------+---------------+
| Browser            |     WebRTC      | Each of your Macs          |
| isbell.fmap.dev    |<===============>| gateway -- herdr -- agents |
+--------------------+     direct      +----------------------------+
     terminal and files go direct; through the relay only if that fails
```

- **No user data on the server**
  - The relay only pairs browsers with gateways and passes messages along.
  - Redis holds routing and each machine's last status, all expiring within 15 minutes, never on
    disk; messages pass through its pub/sub and are not stored or logged.
  - Your key, settings and read marks stay on your machines and in your browser.
- **Direct first**: terminals and files go over a WebRTC direct link, not through the server; when
  none can be opened, the same traffic goes through the relay.
- **One key per space**: the key is the only credential; each connection signs with it, and the
  relay checks the signature without ever receiving the key.
- **Gateways only dial out**: a machine opens no port; its gateway connects to the relay.
- **TLS, not end to end**: what goes through the relay is visible to the relay as it passes.

## Install

```bash
curl -fsSL https://isbell.fmap.dev/install.sh | sh
```

- Installs the latest release to `~/.local/bin/isbell`, after checking its checksum.
- Run it again to upgrade; it restarts the gateway service too.
- Offers herdr's own installer when herdr is missing.
- `ISBELL_VERSION=v0.1.0` before `sh` installs that release instead, to go back to it.
- Macs with Apple silicon only, for now.

### From source

On other systems, or to run `main`, with Rust (<https://rustup.rs>) and herdr installed:

```bash
cargo install --git https://github.com/bencode/Isbell --locked isbell
```

## Quick start

1. On your first machine: `isbell space init`, which creates your space and prints its key.
2. Then `isbell gateway install`, which keeps the gateway running for this machine.
3. Open <https://isbell.fmap.dev> and paste the key.
4. On each other machine: `isbell space join <key>`, then `isbell gateway install`.

- `isbell space show` prints the key again on any machine in the space.
- `gateway install` makes a launchd user agent (macOS): started at login, restarted after a
  failure, logging to `~/Library/Logs/isbell/gateway.log`.
- It keeps the `PATH` of the shell it ran in, so herdr and the agents are found; run it again after
  changing `PATH`.
- `gateway status` and `gateway uninstall` check and remove it; elsewhere, run
  `isbell gateway run` under a supervisor of your own.

## CLI

```bash
isbell machine list
isbell machine probe <machine>                        # tries a direct link, shows its path
isbell agent prompt <machine>/<agent> "..." --wait
isbell terminal attach <machine>/<pane-or-agent> --control
isbell file get <machine>:<absolute path>
```

## Self-hosting

`deploy/compose.yml` runs the public relay with its own Redis, and the web app as static files.
On the host, from the repository root:

```bash
docker compose -f deploy/compose.yml up -d --build
```

The host's TLS reverse proxy serves both at `isbell.fmap.dev`, by path:

| Path | Upstream |
|---|---|
| `/v1/*`, `/healthz` | relay on `172.17.0.1:5800` |
| everything else | web app on `172.17.0.1:5801` |

## Development

Building, running a local relay, tests and releasing: [docs/development.md](docs/development.md).
