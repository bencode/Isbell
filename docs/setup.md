# Set up Isbell on this Mac

For the agent doing the setup. Isbell lets its user reach the agents on their Macs from a browser:
`isbell` runs a gateway on each Mac, beside [herdr](https://herdr.dev), where the agents run.

## Rules

- Never print, read or repeat the space key. Never put it in a command line. `space init` and
  `space show` print it, so send their output to `/dev/null`.
- Ask the user before installing herdr.

## Checklist

- [ ] `uname -sm` is `Darwin arm64`. Otherwise stop: the installer is for Macs with Apple silicon;
      the README says how to build from source.
- [ ] Install or upgrade: `curl -fsSL https://isbell.fmap.dev/install.sh | sh`. Make sure
      `~/.local/bin` is on the user's `PATH`.
- [ ] herdr is installed: `command -v herdr` in a login shell. If not, with the user's yes:
      `curl -fsSL https://herdr.dev/install.sh | sh`.
- [ ] The space: if `isbell space show >/dev/null 2>&1` succeeds, there is one already. If not, ask
      the user whether this is their first Mac:
  - first Mac: `isbell space init >/dev/null`;
  - another Mac: the user runs `isbell space join <key>` themselves.
- [ ] Gateway service, from the user's login shell, so it finds herdr and the agents:
      `$SHELL -lc 'isbell gateway install'`.
- [ ] Check:
  - `isbell gateway status` says `running`;
  - `isbell machine list` shows this Mac `online`.

  If either check fails, look at the end of `~/Library/Logs/isbell/gateway.log`.
- [ ] Tell the user:
  1. Run `isbell space show` in your own terminal and copy the key.
  2. Open <https://isbell.fmap.dev> and paste it.
  3. Start agents inside herdr (run `herdr`); Isbell sees what runs there.
  4. For another Mac, give its agent this same file.

## Uninstall

`isbell gateway uninstall`, `isbell space leave`, then delete `~/.local/bin/isbell`.
