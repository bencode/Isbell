#!/bin/sh
# Brings this skill to the version of the isbell installed: each release carries its own, as
# isbell-tools.tar.gz beside the binary. A checkout has no VERSION, and is left as it is.
#
#   sh <this skill's directory>/update.sh
set -eu

fail() {
  printf 'isbell-tools update: %s\n' "$*" >&2
  exit 1
}

# Through a link, the directory itself: every agent's link then finds what replaces it.
dir=$(cd "$(dirname "$0")" && pwd -P)
have=$(cat "$dir/VERSION" 2>/dev/null || true)
if [ -z "$have" ]; then
  echo "a checkout, kept as it is"
  exit 0
fi
want=$(isbell --version 2>/dev/null | awk '{print $2}')
[ -n "$want" ] || fail "isbell is not installed, or not on PATH"
if [ "$have" = "$want" ]; then
  echo "current ($have)"
  exit 0
fi

# The releases mirrored for install.sh, which many networks reach faster than GitHub's; the same
# limits, so it fails rather than hangs.
url=https://isbell.fmap.dev/releases/v$want
asset=isbell-tools.tar.gz
fetch() { curl -fsSL --connect-timeout 15 --speed-limit 1024 --speed-time 30 "$1" -o "$2"; }

# Beside the skill, so the moves that swap it stay on one disk.
tmp=$(mktemp -d "$dir.update.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
fetch "$url/$asset" "$tmp/$asset" || fail "no $asset for isbell $want at $url: upgrade isbell"
fetch "$url/$asset.sha256" "$tmp/$asset.sha256" || fail "cannot download $url/$asset.sha256"
(cd "$tmp" && shasum -a 256 -c "$asset.sha256" >/dev/null 2>&1) || fail "the download does not match its checksum"
tar -xzf "$tmp/$asset" -C "$tmp"
[ -f "$tmp/isbell-tools/SKILL.md" ] || fail "$asset holds no isbell-tools/SKILL.md"

mv "$dir" "$tmp/old"
mv "$tmp/isbell-tools" "$dir" || { mv "$tmp/old" "$dir"; fail "cannot put the new version in $dir"; }
echo "updated $have -> $want: read SKILL.md again"
