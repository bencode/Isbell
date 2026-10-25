#!/bin/sh
# Installs isbell on a Mac with Apple silicon, or upgrades it; the same command does both:
#
#   curl -fsSL https://isbell.fmap.dev/install.sh | sh
#
# ISBELL_VERSION=v0.1.0 installs that release instead of the latest, to go back to it.
set -eu

REPO=bencode/Isbell
ASSET=isbell-aarch64-apple-darwin.tar.gz
LABEL=dev.fmap.isbell.gateway
BIN_DIR=$HOME/.local/bin
BIN=$BIN_DIR/isbell

say() { printf '%s\n' "$*"; }
fail() {
  printf 'isbell install: %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] ||
  fail "only Macs with Apple silicon are supported for now; elsewhere, build from source (see https://github.com/$REPO#from-source)"

if [ -n "${ISBELL_VERSION:-}" ]; then
  url=https://github.com/$REPO/releases/download/$ISBELL_VERSION
else
  url=https://github.com/$REPO/releases/latest/download
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url/$ASSET" -o "$tmp/$ASSET" || fail "cannot download $url/$ASSET"
curl -fsSL "$url/$ASSET.sha256" -o "$tmp/$ASSET.sha256" || fail "cannot download $url/$ASSET.sha256"
(cd "$tmp" && shasum -a 256 -c "$ASSET.sha256" >/dev/null 2>&1) || fail "the download does not match its checksum"
tar -xzf "$tmp/$ASSET" -C "$tmp"

# Copied beside the old one first, so the move that replaces it is atomic.
before=$("$BIN" --version 2>/dev/null || true)
mkdir -p "$BIN_DIR"
cp "$tmp/isbell" "$BIN_DIR/.isbell.new"
chmod 755 "$BIN_DIR/.isbell.new"
mv -f "$BIN_DIR/.isbell.new" "$BIN"
after=$("$BIN" --version)
if [ -z "$before" ]; then
  say "Installed $after at $BIN"
elif [ "$before" = "$after" ]; then
  say "$after is already the newest; reinstalled it at $BIN"
else
  say "Upgraded $before -> $after at $BIN"
fi

# A gateway service runs the binary it was installed with; restart it when that is this one.
plist=$HOME/Library/LaunchAgents/$LABEL.plist
if [ -f "$plist" ]; then
  runs=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$plist" 2>/dev/null || true)
  if [ "$runs" = "$BIN" ]; then
    if launchctl kickstart -k "gui/$(id -u)/$LABEL"; then
      say "Restarted the gateway"
    else
      say "Could not restart the gateway; run: $BIN gateway install"
    fi
  else
    say "The gateway service runs ${runs:-another binary}. To have it run this one:"
    say "  $BIN gateway install"
  fi
fi

if ! command -v herdr >/dev/null 2>&1; then
  say ""
  say "isbell works with herdr (https://herdr.dev), which is not installed."
  answer=
  if { printf 'Install it now with its official installer? [y/N] ' >/dev/tty; } 2>/dev/null; then
    read -r answer </dev/tty || answer=
  fi
  if [ "$answer" = y ] || [ "$answer" = Y ]; then
    curl -fsSL https://herdr.dev/install.sh | sh
  else
    say "Install it with:"
    say "  curl -fsSL https://herdr.dev/install.sh | sh"
  fi
fi

case ":$PATH:" in
*":$BIN_DIR:"*) ;;
*)
  say ""
  say "$BIN_DIR is not on your PATH. To add it:"
  say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc && exec zsh"
  ;;
esac

if ! "$BIN" space show >/dev/null 2>&1; then
  say ""
  say "Next, on your first machine:"
  say "  isbell space init && isbell gateway install"
  say "or on another machine, with the key from your first:"
  say "  isbell space join <key> && isbell gateway install"
  say "Then open https://isbell.fmap.dev and paste the key."
fi
