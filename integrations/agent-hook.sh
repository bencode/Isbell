#!/bin/sh
# Isbell's hook for Claude Code, Codex and pi: records each session in ~/.isbell/sessions, wherever
# it runs, so Isbell can list it and resume it once its pane is gone; and tells herdr, for the pane
# the agent runs in, what the turn was asked, the tool it runs, the tool it asks leave to run, and
# its permission mode, so Isbell's board can show them.
#
#   sh agent-hook.sh install   claude|codex|pi [--config-dir DIR]   register it with the agent
#   sh agent-hook.sh uninstall claude|codex|pi [--config-dir DIR]   remove it
#   sh agent-hook.sh status    claude|codex|pi [--config-dir DIR]   say whether it is registered and current
#
# Claude Code: DIR/settings.json, DIR being CLAUDE_CONFIG_DIR, else ~/.claude.
# Codex: DIR/hooks.json, DIR being CODEX_HOME, else ~/.codex.
# pi: DIR/extensions/isbell-agent-hook.ts, DIR being PI_CODING_AGENT_DIR, else ~/.pi/agent.
# The agent runs it as `sh <path> report claude|codex|pi`; pi's extension tells it pi's events as
# Claude Code tells its hooks.
#
# Every agent runs the one installed copy, which a newer isbell's gateway replaces with its own when
# it starts, registrations untouched. A version that changes EVENTS or pi's extension must be
# installed again.

ISBELL_HOOK_VERSION=6
INSTALLED="$HOME/.isbell/hooks/agent-hook.sh"

# The events registered, and what each reports.
EVENTS="SessionStart UserPromptSubmit PreToolUse PermissionRequest PostToolUse Stop"

REPORT=$(cat <<'PY'
import fcntl, hashlib, json, os, re, socket, subprocess, sys, time

AGENT = sys.argv[1]
STORE = os.path.expanduser("~/.isbell/sessions")
# Kept of a session's prompts, and of its sessions newest first, per project.
PROMPT_MAX = 200
RECENT_MAX = 50

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

# Neither a home nor a directory above one is a project's root (as web/src/model/files/repo.ts).
BROAD = re.compile(r"^/(?:root|(?:Users|home)(?:/[^/]+)?)?$")

def main_of(repo):
    """The repository a worktree was added from, as its .git file says; `repo` itself otherwise (a
    repository's own .git, or a submodule's)."""
    try:
        with open(os.path.join(repo, ".git")) as f:
            line = f.readline()
    except OSError:
        return repo
    gitdir = line[len("gitdir:"):].strip() if line.startswith("gitdir:") else ""
    # Git may write the path relative to the worktree.
    main, sep, _ = os.path.normpath(os.path.join(repo, gitdir)).partition("/.git/worktrees/")
    return main if sep and os.path.isdir(main) else repo

def root_of(cwd):
    """The project a directory is in: the deepest repository holding it, a worktree's being the one
    it was added from, or the directory itself."""
    cwd = cwd.rstrip("/") or "/"
    d = cwd
    while not BROAD.match(d):
        if os.path.lexists(os.path.join(d, ".git")):
            return main_of(d)
        d = os.path.dirname(d)
    return cwd

def key_of(root):
    """The project's directory in the store: readable, and unique by the hash of its root."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", root)[-48:].strip("-")
    return "%s-%s" % (slug, hashlib.sha1(root.encode()).hexdigest()[:8])

def load(path, default):
    """The file's value; `default` when it is not there, or was left unreadable (written over again)."""
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except ValueError as err:
        print("isbell hook: starting %s over, as it cannot be read: %s" % (path, err), file=sys.stderr)
        return default

def put(path, value):
    """Writes `value` whole or not at all, readable by the owner alone, as prompts can be private."""
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(value, f, ensure_ascii=False)
    os.replace(tmp, path)

def record(e):
    """Keeps the session, its project, and its place among the project's latest, once it is asked
    something: a session file, a line in the month it began, the project's recent list, and the
    roots every project is reached from."""
    event = e.get("hook_event_name")
    sid, cwd = e.get("session_id"), e.get("cwd")
    if event not in ("UserPromptSubmit", "Stop") or e.get("agent_id") or not sid:
        return
    # Agents report where they work as an absolute path; another has no project to be found from.
    if not isinstance(cwd, str) or not cwd.startswith("/"):
        return
    # Where the agent keeps the conversation itself, which the chat is read from.
    transcript = e.get("transcript_path")
    transcript = transcript if isinstance(transcript, str) and transcript.startswith("/") else None
    prompt = (e.get("prompt") or "") if event == "UserPromptSubmit" else ""
    # Claude Code submits a background task's end itself; it is not what the session was asked.
    own = prompt and not prompt.startswith("<task-notification>")
    asked = collapse(prompt)[:PROMPT_MAX] if own else None
    now = int(time.time() * 1000)
    # The command Isbell started the agent with, where it was its own (isbell.agent.launch), which
    # resumes it the same way.
    launch = os.environ.get("ISBELL_LAUNCH", "").strip()
    # The store is the owner's alone, and so is everything made inside it.
    os.makedirs(STORE, mode=0o700, exist_ok=True)
    root = root_of(cwd)
    project = os.path.join(STORE, key_of(root))
    path = os.path.join(project, "sessions", "%s-%s.json" % (AGENT, sid))
    session = load(path, None)
    if session is None:
        if not asked:
            return
        session = {"agent": AGENT, "id": sid, "cwd": cwd, "first": asked, "last": asked,
                   "started": now, "updated": now}
        if transcript:
            session["transcript"] = transcript
        if launch:
            session["launch"] = launch
        line = {k: session[k] for k in ("agent", "id", "cwd", "first", "started", "launch") if k in session}
        months = os.path.join(project, "months")
        os.makedirs(months, mode=0o700, exist_ok=True)
        month = os.path.join(months, time.strftime("%Y-%m") + ".jsonl")
        fd = os.open(month, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, (json.dumps(line, ensure_ascii=False) + "\n").encode())
        finally:
            os.close(fd)
    else:
        if asked:
            session["last"] = asked
        if transcript:
            session["transcript"] = transcript
        if launch:
            session["launch"] = launch
        session["updated"] = now
    put(path, session)
    # Agents in one project end their turns together: the shared lists change one at a time.
    with os.fdopen(os.open(os.path.join(STORE, ".lock"), os.O_WRONLY | os.O_CREAT, 0o600), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        recent_path = os.path.join(project, "recent.json")
        others = [s for s in load(recent_path, []) if (s.get("agent"), s.get("id")) != (AGENT, sid)]
        put(recent_path, [session] + others[: RECENT_MAX - 1])
        roots_path = os.path.join(STORE, "roots.json")
        roots = load(roots_path, {})
        roots[root] = {"key": key_of(root), "updated": now}
        put(roots_path, roots)

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

def in_herdr():
    env = os.environ.get
    return env("HERDR_ENV") == "1" and bool(env("HERDR_PANE_ID")) and bool(env("HERDR_SOCKET_PATH"))

try:
    e = json.load(sys.stdin)
except ValueError as err:
    print("isbell hook: %s" % err, file=sys.stderr)
    sys.exit(0)

try:
    record(e)
except Exception as err:
    # Never in the agent's way: the session is missing from Isbell's list, and its hook output says why.
    print("isbell hook: cannot record the session: %s" % err, file=sys.stderr)

try:
    # A subagent's events would stand in for what the session itself is doing.
    skip = not in_herdr() or e.get("agent_id") or (AGENT == "codex" and in_codex_daemon())
    found = None if skip else tokens(e)
    if found is not None:
        # Which agent reported, so what one leaves in a pane says nothing of the next there.
        found["isbell_agent"] = AGENT
        # Which session runs in the pane, so Isbell's list can lead to it rather than start it again.
        found["isbell_session"] = e.get("session_id")
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

# pi's extension, written out by install.
pi_extension() {
  cat <<'TS'
// Isbell's hook for pi, written by agent-hook.sh (install pi); installing again overwrites it.
// pi's events, told as Claude Code tells its hooks, go to the same agent-hook.sh, which records the
// session and tells herdr what the turn was asked and the tool it runs.
// @ts-nocheck
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const HOOK = path.join(os.homedir(), ".isbell/hooks/agent-hook.sh");
// pi's tools by the names the board knows them by (Claude Code's).
const TOOLS = { bash: "Bash", read: "Read", write: "Write", edit: "Edit", grep: "Grep", find: "Glob" };

// One report at a time, in the order pi's events came, as an agent runs its hooks.
let queue = Promise.resolve();

function report(ctx, event) {
  // A session pi keeps no file of (--no-session) cannot be resumed: it is told to herdr, not recorded.
  const kept = ctx.sessionManager.getSessionFile?.();
  const e = { ...event, cwd: ctx.cwd, session_id: kept ? ctx.sessionManager.getSessionId() : undefined, transcript_path: kept };
  const ran = queue.then(() => run(e));
  queue = ran;
  // What the hook says went wrong shows on pi's screen, when it has one. Off the queue: a context
  // pi has since replaced may throw, and the reports after it still go.
  ran.then(err => {
    if (err && ctx.hasUI) ctx.ui.notify("isbell hook: " + err, "warning");
  });
}

/** Runs the hook with the event; what it says went wrong, if anything. */
function run(e) {
  return new Promise(resolve => {
    // Its output stays off pi's screen.
    const child = spawn("sh", [HOOK, "report", "pi"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", d => (err += d));
    child.on("error", x => resolve(String(x)));
    child.on("close", () => resolve(err.trim()));
    child.stdin.end(JSON.stringify(e));
  });
}

// The file a tool works on, where Claude Code's tools give it.
const toolInput = args =>
  args && typeof args === "object" && "path" in args ? { ...args, file_path: args.path } : args;

export default function (pi) {
  pi.on("session_start", (_e, ctx) => report(ctx, { hook_event_name: "SessionStart" }));
  pi.on("input", (e, ctx) => {
    // What an extension sends in is not what the session was asked.
    if (e.source !== "extension") report(ctx, { hook_event_name: "UserPromptSubmit", prompt: e.text });
  });
  pi.on("tool_execution_start", (e, ctx) => {
    // A call another tool made stands in for that tool.
    if (e.parentToolCallId) return;
    const tool_name = TOOLS[e.toolName] ?? e.toolName;
    report(ctx, { hook_event_name: "PreToolUse", tool_name, tool_input: toolInput(e.args) });
  });
  pi.on("tool_execution_end", (e, ctx) => {
    if (!e.parentToolCallId) report(ctx, { hook_event_name: "PostToolUse" });
  });
  pi.on("agent_settled", (_e, ctx) => report(ctx, { hook_event_name: "Stop" }));
}
TS
}

fail() {
  echo "agent-hook: $*" >&2
  exit 1
}

# The agent's config file, from its name and the options after it.
config_file() {
  case "${1:-}" in
    claude) file=settings.json default="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
    codex) file=hooks.json default="${CODEX_HOME:-$HOME/.codex}" ;;
    pi) file=extensions/isbell-agent-hook.ts default="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" ;;
    *) fail "name the agent: claude, codex or pi" ;;
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
    if [ "$agent" = pi ]; then
      # pi loads every extension in the directory; the file is written whole or not at all.
      mkdir -p "$(dirname "$path")" || fail "cannot create $(dirname "$path")"
      pi_extension >"$path.tmp" && mv "$path.tmp" "$path" || fail "cannot write $path"
      echo "registered in $path"
    else
      python3 -c "$SETTINGS" install "$path" "$INSTALLED" "$agent" "$EVENTS" || exit 1
    fi
    echo "Sessions are recorded in ~/.isbell/sessions, for Isbell to list and resume."
    if [ "$agent" = pi ]; then
      echo "pi sessions started from now on report; running ones do once restarted. For its status on"
      echo "the board, herdr's own integration: herdr integration install pi."
    elif [ "$agent" = codex ]; then
      echo "Codex asks to trust the new hooks when it next starts: choose Trust all. They report from"
      echo "Codex started with --no-daemon, as Isbell starts it; its shared daemon runs them outside the pane."
    else
      echo "Claude Code sessions started from now on report to herdr; running ones do once restarted."
    fi
    ;;
  uninstall)
    command -v python3 >/dev/null 2>&1 || fail "python3 is needed"
    path=$(config_file "$@") || exit 1
    # The script stays: the other agents may still run it.
    if [ "$agent" = pi ]; then
      rm -f "$path" || fail "cannot remove $path"
      echo "removed from $(dirname "$path")"
    else
      python3 -c "$SETTINGS" uninstall "$path" "$INSTALLED" "$agent" "$EVENTS" || exit 1
    fi
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
    if [ "$agent" = pi ]; then
      [ -f "$path" ] && echo "registered in $path" || { echo "not registered in $path"; exit 1; }
    else
      python3 -c "$SETTINGS" status "$path" "$INSTALLED" "$agent" "$EVENTS"
    fi
    ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    [ -n "$action" ] && exit 1
    ;;
esac
