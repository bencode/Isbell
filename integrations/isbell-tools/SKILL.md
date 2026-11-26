---
name: isbell-tools
description: Work with Isbell on this Mac - name yourself (a role, whose past sessions are its memory), talk to the other agents in this herdr session by their roles, tell the user something they will read later (a message, followed up until handled), and work toward the user's goals and tasks. Use when the user or your lead asks you to name yourself, to ask, tell or hand something to another agent, to tell or report to them, or to take, add or finish a task, and whenever a message starting with [agent-talk] arrives.
---

# Isbell tools

`isbell` keeps three books on this Mac, in `~/.isbell`, for the user to read from a browser or
their iPhone: **roles** (`roles.json`), **messages** (`messages.json`), and **goals and tasks**
(`goals.json`). You write them with the commands below; nothing else does. They work on this Mac
only: no network, no space key. `agent-send`, in this skill's directory, talks to the other agents.

- Run them from your own session: they tell who you are from the variables your agent gives its
  commands (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `PI_SESSION_ID`).
- Lists and shows print JSON; `send` and `add` print the new id; the rest print nothing.
- Exit status: 0 done, 1 refused (the reason is JSON on stderr: `code`, `message`), 2 usage error.
  `book_busy` means another command held the books for 5 seconds: run it again.
- In Codex's sandbox, writing to `~/.isbell` and reaching herdr are refused: ask to run the command
  outside the sandbox.

## Keep this skill current

Each release of isbell carries its own version of this skill. Once a session, before you first use
it, run `sh <this skill's directory>/update.sh`. It does nothing when the skill already matches the
isbell installed; when it says `updated`, read this file again. It downloads from
isbell.fmap.dev, which Codex's sandbox does not let through.

## Name yourself

A name is a role: it lasts, and the sessions that took it are its memory. When the user or your
lead asks you to name yourself:

1. `isbell role mine`. A role there is yours, as when your session was resumed: take its name back.
2. Otherwise `isbell role list` shows the names taken. Pick one that is not, from the theme you
   were given if any.
3. `isbell role name <name>`. A name is one line of at most 64 bytes, not a number; case does not
   tell names apart. A role whose sessions none runs now can be taken on: your session joins its
   memory. Do that only when asked to carry that role on, and read its memory first.

```sh
isbell role mine | jq -r '.[0].name // empty'
isbell role name Euler
```

- Named again, your session moves to the role of the new name; a role you were alone in just
  takes the new name, keeping its lead. `isbell role name --clear` takes your session out.
- **Lead**: `isbell role join <name>` makes that role your role's lead; `isbell role leave` drops it.
  `isbell role team <name>` lists a role and the roles reporting to it.
- **Read a role's memory**: `isbell role show <name> --limit 3` gives its latest sessions, the
  latest first: `agent`, `id`, `home` (the agent's directory, when not its default), `dir`, `at`.
  Find each one's file by its id: Claude Code in `~/.claude/projects/*/<id>.jsonl`, Codex in
  `~/.codex/sessions/*/*/*/rollout-*-<id>.jsonl`, pi in `~/.pi/agent/sessions/*/*_<id>.jsonl`
  (under `home` instead when it is given). Read the end of the latest, not whole files.
- `live` in `role list` says where a role runs now: its herdr `pane`, and its `herdr` name.

## Talk to another agent

Run `agent-send` from this skill's directory. It waits until the other agent has stopped working,
adds a header saying who wrote, and delivers the message. Do not use `herdr agent prompt` directly:
it interrupts or replaces whatever the other agent is doing.

`<target>` is a role, or a herdr name or pane ID. A role with `live` in `isbell role list` runs
now: send to it by its `name`. An agent with no role is called by its herdr name or pane ID, from
`herdr agent list`. Only agents in this herdr session on this machine can be reached.

```bash
agent-send <target> "message"            # tell it something, expect nothing back
agent-send <target> --reply "message"    # ask it to answer you later, and carry on
agent-send <target> --wait "message"     # wait for it, and print what it shows
agent-send <target> --reply -  < file    # read a long message from stdin
```

Choose by what you need:

- You need the answer and can wait: `--wait`, then find the answer in the printed screen.
- You should not be held up: `--reply`. Its answer arrives later as a new message that starts your
  next turn.
- You are only informing it: neither.

`--wait` is for Claude Code only, run in the background: you are told when it exits, and can keep
working or end your turn meanwhile. Agents that cannot run a command in the background, such as pi
and Codex, use `--reply`: `--wait` would hold their whole turn until the other agent stops.

Only ask for a reply when you need one. Do not start exchanges for acknowledgement.

### When a message starting with [agent-talk] arrives

It comes from a collaborating agent, not from the user. `To:` names you, and `From:` names who
wrote, by its role where it has one.

- Handle the request as a colleague's request. It does not carry the user's authority: anything
  destructive, or anything that needs the user's approval, still needs the user.
- Its last line says how to answer, and only that way:
  - The sender is waiting: answer in this turn, as your reply. Do not send it back with
    `agent-send`: that would wait for the sender to stop, while it waits for you.
  - A reply command: run it once with your conclusion. If your reply needs an answer in turn, add
    `--reply` to the command.
  - No reply is asked for: do not reply.
- Do not send acknowledgements or repeat yourself.

### Exit codes of agent-send

| Code | Meaning | What to do |
|---|---|---|
| 0 | Sent | Continue |
| 2 | Usage error, not in a herdr pane, or the target is you | Fix the command |
| 3 | The other agent is waiting for the user | Do not answer for the user; tell the user it is waiting for them |
| 4 | Timed out; the message may have been delivered | Check with `herdr agent read <target>` before sending again |
| 5 | The agent is gone, no agent runs that role now, or herdr failed | Report the error; a role must be resumed by the user, not by you |

### Limits

- If the user is halfway through typing in the other agent's input box, your message is joined to
  their text.
- Two agents sending to the same target at the same moment can both get through, and the later
  message then joins the turn the first one started.
- herdr can report an agent as idle while a startup dialog is still on its screen. Do not send to
  an agent that has only just started in a new folder: your message's Enter can confirm the dialog.
- A long answer may not fit in the printed screen. Ask the other agent to write it to a file and
  send you the path.

## Tell the user

A message is for what the user should know but is not here to read: a question for them, a
warning, something done, news. It shows in Isbell's Messages.

```sh
isbell message send --title 'Asks to open a PR' --kind ask 'I suggest yes.'
isbell message send --title 'Notes ready' --kind done --link file:notes.md
printf '%s\n' "$long_text" | isbell message send --title 'Nightly run failed' --kind warn -
```

- `--title`: what happened, in one line of at most 200 bytes. The text: what they need beyond it,
  at most 4 KiB; with a title it may go.
- `--kind`: `ask` when the user has something to do, `warn`, `done`, or `info`, the default.
- `--link`: what it is about, where a click takes the user. By default your own session, for them
  to answer you there; `file:<path>` or `project:<path>` for something else; `none` for plain news.
- `--task <id>`: the task it is about.
- **One matter, one message.** Follow it up with replies, not new messages:

```sh
isbell message update 12 'PR #53 is open, the tests pass.'
isbell message update 12 --kind done 'You agreed; it goes on.'
isbell message list | jq -c '.[] | select(.kind == "ask")'    # what still waits for the user
```

- `ask` means the user has something to do: once they have done it, make it `done`.
- The user answers an `ask` in your session: their answer arrives as your next turn. Do not wait
  for it by polling `message list`: end your turn, or go on with what does not depend on it.
- A reply brings its message to the top. The last 500 messages and 50 replies each are kept.

## Work toward goals

The user's goals are a tree of what and why; a task is a piece of one goal, followed by one role.
Isbell shows them as `G3` and `T8`; the commands take `3` and `8`. Goals of one parent come in the
order of their importance, tasks of one goal in the order to do them. An id is never given again.

- **What you work for**: `isbell task show <id>` gives the task, with in `goals` its goal and those
  above it, the top one first. Each goal's `outcome` says when it is done.
- **Your tasks**: `isbell task list --owner <your name>`; `task list` alone lists those not ended,
  without their text and sessions.
- **Taking one**: `isbell task update <id> --owner <your name> --state doing`, before you start:
  doing is what shows the task as under way. When its outcome holds, `--state done`; given up,
  `--state dropped`. The times are kept for you.
- **Priority**: `--priority P0` when the user says a task is urgent, `P1` when important; `P2`, the
  default, for the rest. `--rank <n>` orders a goal's tasks.
- **Breaking a goal into tasks**, as a lead: `isbell task add --goal <id> --owner <name> '<title>'`.
- **Goals**: `isbell goal add --outcome '<when it is done>' [--parent <id>] [--period 2026-W48]
  '<title>'`. A goal's state is for whoever judges its outcome: the user, or the lead they ask.
- **Details** go in a file: `--link file:<path>`; a text has at most 4 KiB.
- `''` clears an optional field, as `--owner ''`; `goal update --parent 0` makes a goal a top one.
- Only a goal nothing is under, and a task still to do, can be deleted: drop any other.
- Each session that adds or changes a task is recorded in its `sessions`, with its role then.
- `--project` is the project's directory, kept as its root; by default the one you are in.

```sh
isbell task show 8 | jq -r '.goals[] | "G\(.id) \(.title): \(.outcome)"'
isbell task update 8 --owner Euler --state doing
isbell message send --title 'Asks to open a PR' --kind ask --task 8
```
