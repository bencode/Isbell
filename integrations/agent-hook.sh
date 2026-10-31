#!/bin/sh
# Isbell's hook for Claude Code and Codex: tells herdr, for the pane the agent runs in, what the
# turn was asked, the tool it runs, the tool it asks leave to run, and its permission mode, so
# Isbell's board can show them. It does nothing outside herdr.
#
#   sh agent-hook.sh install   claude|codex [--config-dir DIR]   register it with the agent
#   sh agent-hook.sh uninstall claude|codex [--config-dir DIR]   remove it
#   sh agent-hook.sh status    claude|codex [--config-dir DIR]   say whether it is registered and current
#
# Claude Code: DIR/settings.json, DIR being CLAUDE_CONFIG_DIR, else ~/.claude.
# Codex: DIR/hooks.json, DIR being CODEX_HOME, else ~/.codex.
# The agent runs it as `sh <path> report claude|codex`.

ISBELL_HOOK_VERSION=1
INSTALLED="$HOME/.isbell/hooks/agent-hook.sh"

# The events registered, and what each reports.
EVENTS="SessionStart UserPromptSubmit PreToolUse PermissionRequest PostToolUse Stop"

REPORT=$(cat <<'PY'
import json, os, re, socket, subprocess, sys, time

AGENT = sys.argv[1]

def target(tool, i):
    """What the tool works on, as one short line."""
    if not isinstance(i, dict):
        return None
    if tool == "Bash":
        # Codex's description, when it asks leave, is why its sandbox stopped the command.
        return i.get("command") if AGENT == "codex" else i.get("description") or i.get("command")
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

# The files a Codex patch touches: "*** Update File: /abs/path".
PATCHED = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.M)

def named(tool, i):
    """The tool by the name the board knows: a Codex patch is an edit."""
    if tool == "apply_patch":
        files = PATCHED.findall(i.get("command") or "") if isinstance(i, dict) else []
        return "Edit", ", ".join(os.path.basename(f.strip()) for f in files) or None
    return tool, target(tool, i)

def in_codex_daemon():
    """Whether Codex's shared daemon runs the hook, not the codex in the pane: the daemon serves
    every session, with the env of the terminal that first started it, so its HERDR_PANE_ID, if
    any, names some other pane. The nearest codex above the hook says which."""
    pid = os.getppid()
    for _ in range(4):
        ps = subprocess.run(["ps", "-o", "ppid=,command=", "-p", str(pid)], capture_output=True, text=True)
        parent, _, command = ps.stdout.strip().partition(" ")
        argv = command.split()
        if not argv:
            return False
        if os.path.basename(argv[0]) == "codex":
            return argv[1:2] == ["app-server"]
        pid = int(parent)
    return False

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
        tool, on = named(tool, e.get("tool_input"))
        # A request turned down never reaches PostToolUse; the next tool means it is over.
        return {"isbell_tool": tool, "isbell_target": collapse(on), **CLEAR_WAIT}
    if event == "PermissionRequest":
        tool, on = named(tool, e.get("tool_input"))
        return {"isbell_wait_tool": tool, "isbell_wait_target": collapse(on)}
    if event == "PostToolUse":
        return dict(CLEAR_WAIT)
    if event == "Stop":
        return {**CLEAR_TOOL, **CLEAR_WAIT}
    return None

try:
    e = json.load(sys.stdin)
    # A subagent's events would stand in for what the session itself is doing.
    found = None if e.get("agent_id") or (AGENT == "codex" and in_codex_daemon()) else tokens(e)
    if found is not None:
        # Which agent reported, so what one leaves in a pane says nothing of the next there.
        found["isbell_agent"] = AGENT
        mode = e.get("permission_mode")
        if mode:
            found["isbell_mode"] = mode
        request = {
            "id": "isbell:%s:%d" % (AGENT, time.time_ns()),
            "method": "pane.report_metadata",
            "params": {
                "pane_id": os.environ["HERDR_PANE_ID"],
                "source": "isbell:" + AGENT,
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
    # Never in the agent's way: the board shows less, and the agent's hook output says why.
    print("isbell hook: %s" % err, file=sys.stderr)
PY
)

SETTINGS=$(cat <<'PY'
import json, os, sys

action, path, installed, agent, events = sys.argv[1:5] + [sys.argv[5].split()]
ours = lambda entry: any("/.isbell/hooks/agent-hook.sh" in h.get("command", "") for h in entry.get("hooks", []))

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
    command = "sh '%s' report %s" % (installed, agent)
    for event in events:
        hooks.setdefault(event, []).append({"hooks": [{"type": "command", "command": command, "timeout": 5}]})
if hooks:
    settings["hooks"] = hooks
else:
    settings.pop("hooks", None)

# Settings can hold secrets (`env`): the file keeps its mode, and a new one is the owner's alone.
try:
    mode = os.stat(path).st_mode & 0o777
except FileNotFoundError:
    mode = 0o600
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = path + ".isbell-tmp"
with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.chmod(tmp, mode)
os.replace(tmp, path)
print("%s %s" % ("registered in" if action == "install" else "removed from", path))
PY
)

fail() {
  echo "agent-hook: $*" >&2
  exit 1
}

# The agent's config file, from its name and the options after it.
config_file() {
  case "${1:-}" in
    claude) file=settings.json default="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
    codex) file=hooks.json default="${CODEX_HOME:-$HOME/.codex}" ;;
    *) fail "name the agent: claude or codex" ;;
  esac
  case "${2:-}" in
    --config-dir) [ -n "${3:-}" ] || fail "--config-dir needs a directory"; echo "$3/$file" ;;
    "") echo "$default/$file" ;;
    *) fail "unknown option $2" ;;
  esac
}

action="${1:-}"
[ $# -gt 0 ] && shift
agent="${1:-}"
case "$action" in
  report)
    [ "${HERDR_ENV:-}" = "1" ] && [ -n "${HERDR_PANE_ID:-}" ] && [ -n "${HERDR_SOCKET_PATH:-}" ] || exit 0
    command -v python3 >/dev/null 2>&1 || exit 0
    python3 -c "$REPORT" "$agent"
    exit 0
    ;;
  install)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    path=$(config_file "$@") || exit 1
    mkdir -p "$(dirname "$INSTALLED")" || fail "cannot create $(dirname "$INSTALLED")"
    if [ "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" != "$INSTALLED" ]; then
      cp "$0" "$INSTALLED" || fail "cannot copy itself to $INSTALLED"
    fi
    python3 -c "$SETTINGS" install "$path" "$INSTALLED" "$agent" "$EVENTS" || exit 1
    if [ "$agent" = codex ]; then
      echo "Codex asks to trust the new hooks when it next starts: choose Trust all. They report from"
      echo "Codex started with --no-daemon, as Isbell starts it; its shared daemon runs them outside the pane."
    else
      echo "Claude Code sessions started from now on report to herdr; running ones do once restarted."
    fi
    ;;
  uninstall)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    path=$(config_file "$@") || exit 1
    # The script stays: the other agent may still run it.
    python3 -c "$SETTINGS" uninstall "$path" "$INSTALLED" "$agent" "$EVENTS" || exit 1
    ;;
  status)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    path=$(config_file "$@") || exit 1
    if [ -f "$INSTALLED" ]; then
      have=$(sed -n 's/^ISBELL_HOOK_VERSION=//p' "$INSTALLED")
      [ "$have" = "$ISBELL_HOOK_VERSION" ] && echo "installed: $INSTALLED (v$have)" ||
        echo "installed: $INSTALLED (v$have, this is v$ISBELL_HOOK_VERSION: run install again)"
    else
      echo "not installed: no $INSTALLED"
    fi
    python3 -c "$SETTINGS" status "$path" "$INSTALLED" "$agent" "$EVENTS"
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    [ -n "$action" ] && exit 1
    ;;
esac
