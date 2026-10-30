#!/bin/sh
# Isbell's hook for Claude Code: tells herdr, for the pane Claude runs in, what the turn was asked,
# the tool it runs, the tool it asks leave to run, and its permission mode, so Isbell's board can
# show them. It does nothing outside herdr.
#
#   sh claude-hook.sh install   [--config-dir DIR]   register it in DIR/settings.json
#   sh claude-hook.sh uninstall [--config-dir DIR]   remove it
#   sh claude-hook.sh status    [--config-dir DIR]   say whether it is registered and current
#
# DIR is CLAUDE_CONFIG_DIR, else ~/.claude. Claude Code runs it as `sh <path> report`.

ISBELL_HOOK_VERSION=1
INSTALLED="$HOME/.isbell/hooks/claude-hook.sh"

# The events registered, and what each reports.
EVENTS="SessionStart UserPromptSubmit PreToolUse PermissionRequest PostToolUse Stop"

REPORT=$(cat <<'PY'
import json, os, re, socket, sys, time

def target(tool, i):
    """What the tool works on, as one short line."""
    if not isinstance(i, dict):
        return None
    if tool == "Bash":
        return i.get("description") or i.get("command")
    if tool in ("Read", "Write", "Edit", "MultiEdit"):
        return os.path.basename(i.get("file_path") or "") or None
    if tool == "NotebookEdit":
        return os.path.basename(i.get("notebook_path") or "") or None
    if tool in ("Grep", "Glob"):
        return i.get("pattern")
    if tool == "WebFetch":
        return i.get("url")
    if tool == "WebSearch":
        return i.get("query")
    if tool in ("Agent", "Task"):
        return i.get("description")
    if tool == "ExitPlanMode":
        line = next((l for l in (i.get("plan") or "").splitlines() if l.strip()), "")
        return line.lstrip("#").strip() or None
    return None

def collapse(s):
    return re.sub(r"\s+", " ", s).strip() if isinstance(s, str) else None

CLEAR_TOOL = {"isbell_tool": None, "isbell_target": None}
CLEAR_WAIT = {"isbell_wait_tool": None, "isbell_wait_target": None}

def tokens(e):
    event = e.get("hook_event_name")
    tool = e.get("tool_name")
    if event == "SessionStart":
        return {"isbell_ask": None, **CLEAR_TOOL, **CLEAR_WAIT}
    if event == "UserPromptSubmit":
        prompt = e.get("prompt") or ""
        # Claude Code submits a background task's end itself; the question stays the user's.
        if prompt.startswith("<task-notification>"):
            return {**CLEAR_TOOL, **CLEAR_WAIT}
        return {"isbell_ask": collapse(prompt), **CLEAR_TOOL, **CLEAR_WAIT}
    if event == "PreToolUse":
        # A request turned down never reaches PostToolUse; the next tool means it is over.
        return {"isbell_tool": tool, "isbell_target": collapse(target(tool, e.get("tool_input"))), **CLEAR_WAIT}
    if event == "PermissionRequest":
        return {"isbell_wait_tool": tool, "isbell_wait_target": collapse(target(tool, e.get("tool_input")))}
    if event == "PostToolUse":
        return dict(CLEAR_WAIT)
    if event == "Stop":
        return {**CLEAR_TOOL, **CLEAR_WAIT}
    return None

try:
    e = json.load(sys.stdin)
    # A subagent's events would stand in for what the session itself is doing.
    found = None if e.get("agent_id") else tokens(e)
    if found is not None:
        mode = e.get("permission_mode")
        if mode:
            found["isbell_mode"] = mode
        request = {
            "id": "isbell:claude:%d" % time.time_ns(),
            "method": "pane.report_metadata",
            "params": {
                "pane_id": os.environ["HERDR_PANE_ID"],
                "source": "isbell:claude",
                "seq": time.time_ns(),
                "tokens": {k: (v or None) for k, v in found.items()},
            },
        }
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(0.5)
            client.connect(os.environ["HERDR_SOCKET_PATH"])
            client.sendall((json.dumps(request) + "\n").encode())
            answer = json.loads(client.recv(65536) or b"{}")
        if "error" in answer:
            print("isbell hook: herdr refused the report: %s" % answer["error"], file=sys.stderr)
except Exception as err:
    # Never in Claude's way: the board shows less, and Claude's verbose output says why.
    print("isbell hook: %s" % err, file=sys.stderr)
PY
)

SETTINGS=$(cat <<'PY'
import json, os, sys

action, path, installed, events = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split()
ours = lambda entry: any("/.isbell/hooks/claude-hook.sh" in h.get("command", "") for h in entry.get("hooks", []))

try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}
except ValueError as err:
    sys.exit("cannot read %s: %s" % (path, err))

hooks = settings.get("hooks", {})
if action == "status":
    have = [e for e in events if any(ours(x) for x in hooks.get(e, []))]
    print("registered for %d of %d events in %s" % (len(have), len(events), path))
    sys.exit(0 if len(have) == len(events) else 1)

for event in list(hooks):
    hooks[event] = [x for x in hooks[event] if not ours(x)]
    if not hooks[event]:
        del hooks[event]
if action == "install":
    command = "sh '%s' report" % installed
    for event in events:
        hooks.setdefault(event, []).append({"hooks": [{"type": "command", "command": command, "timeout": 5}]})
if hooks:
    settings["hooks"] = hooks
else:
    settings.pop("hooks", None)

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path + ".isbell-tmp", "w") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(path + ".isbell-tmp", path)
print("%s %s" % ("registered in" if action == "install" else "removed from", path))
PY
)

fail() {
  echo "claude-hook: $*" >&2
  exit 1
}

config_dir() {
  case "${1:-}" in
    --config-dir) [ -n "${2:-}" ] || fail "--config-dir needs a directory"; echo "$2" ;;
    "") echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
    *) fail "unknown option $1" ;;
  esac
}

action="${1:-}"
[ $# -gt 0 ] && shift
case "$action" in
  report)
    [ "${HERDR_ENV:-}" = "1" ] && [ -n "${HERDR_PANE_ID:-}" ] && [ -n "${HERDR_SOCKET_PATH:-}" ] || exit 0
    command -v python3 >/dev/null 2>&1 || exit 0
    python3 -c "$REPORT"
    exit 0
    ;;
  install)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    dir=$(config_dir "$@") || exit 1
    mkdir -p "$(dirname "$INSTALLED")" || fail "cannot create $(dirname "$INSTALLED")"
    if [ "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" != "$INSTALLED" ]; then
      cp "$0" "$INSTALLED" || fail "cannot copy itself to $INSTALLED"
    fi
    python3 -c "$SETTINGS" install "$dir/settings.json" "$INSTALLED" "$EVENTS" || exit 1
    echo "Claude Code sessions started from now on report to herdr; running ones do once restarted."
    ;;
  uninstall)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    dir=$(config_dir "$@") || exit 1
    python3 -c "$SETTINGS" uninstall "$dir/settings.json" "$INSTALLED" "$EVENTS" || exit 1
    rm -f "$INSTALLED"
    ;;
  status)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    dir=$(config_dir "$@") || exit 1
    if [ -f "$INSTALLED" ]; then
      have=$(sed -n 's/^ISBELL_HOOK_VERSION=//p' "$INSTALLED")
      [ "$have" = "$ISBELL_HOOK_VERSION" ] && echo "installed: $INSTALLED (v$have)" ||
        echo "installed: $INSTALLED (v$have, this is v$ISBELL_HOOK_VERSION: run install again)"
    else
      echo "not installed: no $INSTALLED"
    fi
    python3 -c "$SETTINGS" status "$dir/settings.json" "$INSTALLED" "$EVENTS"
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    [ -n "$action" ] && exit 1
    ;;
esac
