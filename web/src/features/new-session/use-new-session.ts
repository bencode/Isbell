// What New is filled in with and what starting it does: where (a project, or a directory that is not
// one yet), as a chat or a terminal, with which agent or a plain shell, and the task. A computer's
// panel and a phone's page lay it out each in their own way.

import { useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { getLocal, updateLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { CHAT_AGENTS } from '../../model/agents'
import { openShell, type Started, startAgent } from '../../model/herdr'
import { projectKey } from '../../model/projects'
import { machineOf, type Space } from '../../model/space'
import { sessionHref, terminalHref } from '../../utils/hrefs'
import { useNewDir } from './dir-input'

type Mode = 'chat' | 'terminal'
/** The agent choice that starts no agent: a plain shell. Agent kinds never contain ':'. */
export const SHELL = ':shell'

/** Where to start: a directory on a machine, and how to show it. */
type Target = { mid: string; path: string; machine: string; display: string }

/** Where what was started is, and a task that did not reach it. */
export type Next = { href: string; state?: { promptError?: Started['promptError'] } }

/** Starts what the form describes and says where to go next. */
async function launch(
  space: Space,
  { mid, path }: Target,
  mode: Mode,
  kind: string,
  prompt: string,
): Promise<Next> {
  if (kind === SHELL) {
    const paneId = await openShell(space.openThenEnd, mid, path)
    await space.refreshShells(mid)
    return { href: terminalHref(mid, paneId) }
  }
  const chat = mode === 'chat'
  const started = await startAgent(space.call, mid, {
    cwd: path,
    kind,
    // In its regular mode pi leaves the conversation in the terminal's history for the chat to
    // read; in a terminal it keeps its full screen.
    ...(chat && kind === 'pi' ? { args: ['--tui-mode', 'regular'] } : {}),
    ...(chat && prompt ? { prompt } : {}),
  })
  return chat
    ? { href: sessionHref(mid, started.paneId), state: { promptError: started.promptError } }
    : { href: terminalHref(mid, started.paneId) }
}

function agentsFor(kinds: string[], recent: string[]) {
  const rank = (k: string) => (recent.includes(k) ? recent.indexOf(k) : recent.length)
  return [...kinds].sort((a, b) => rank(a) - rank(b))
}

export type NewSessionForm = ReturnType<typeof useNewSession>

/** `focusedKey`: the project to start in, if it can be. `newDir`: start on a new directory rather than
 * on the projects there are. `onStarted`: it is starting on its machine, a chat or not. */
export function useNewSession({
  focusedKey,
  newDir,
  onStarted,
}: {
  focusedKey: string | undefined
  newDir: boolean
  onStarted: (next: Next, chat: boolean) => void
}) {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const startable = projects.filter(p => p.online && p.path)
  const [key, setKey] = useState(startable.some(p => p.key === focusedKey) ? (focusedKey ?? null) : null)
  const project = startable.find(p => p.key === key)

  const online = view.machines.filter(m => m.online && m.state.herdr.status === 'ready').map(m => m.state)
  const [where, setWhere] = useState<'project' | 'dir'>(newDir || !startable.length ? 'dir' : 'project')
  const inDir = where === 'dir'
  const focusedMid = projects.find(p => p.key === focusedKey)?.mid
  const [picked, setPicked] = useState(focusedMid)
  // The machine picked, or the first one online while it is not, so the field never sticks to one gone.
  const mid = (online.find(m => m.machine.id === picked) ?? online[0])?.machine.id ?? ''
  const [dir, setDir] = useState('')
  const dirMachine = online.find(m => m.machine.id === mid)
  const helps = dirMachine?.caps.methods.includes('isbell.file.list') ?? false
  const fresh = useNewDir(mid, dir, inDir && helps)

  const machine = inDir ? dirMachine?.machine : project && { id: project.mid, name: project.machine }
  const target: Target | undefined = inDir
    ? dirMachine && fresh.dir
      ? {
          mid,
          path: fresh.dir,
          machine: dirMachine.machine.name,
          display: dir.trim().replace(/(.)\/+$/, '$1'),
        }
      : undefined
    : project && { mid: project.mid, path: project.path, machine: project.machine, display: project.display }
  const kinds = machine
    ? agentsFor(machineOf(view.machines, machine.id)?.state.caps.agentKinds ?? [], getLocal().recentAgents)
    : []
  const [mode, setMode] = useState<Mode>('chat')
  const chat = mode === 'chat'
  // A chat is with an agent Isbell is built for; a terminal runs any installed one.
  const offered = chat ? kinds.filter(k => CHAT_AGENTS.includes(k)) : kinds
  const [chosen, setChosen] = useState<string | null>(null)
  const last = target ? getLocal().lastAgent[projectKey(target.mid, target.path)] : undefined
  // A chat falls back to the agent used last; a terminal opens a plain shell unless an agent is picked.
  const pickable = chat ? offered : [...offered, SHELL]
  const kind = [chosen, ...(chat ? [last, offered[0]] : [SHELL])].find(k => k && pickable.includes(k)) ?? null
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const start = async () => {
    if (!target || !kind || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const next = await launch(space, target, mode, kind, task.trim())
      if (kind !== SHELL)
        updateLocal(l => ({
          lastAgent: { ...l.lastAgent, [projectKey(target.mid, target.path)]: kind },
          recentAgents: [kind, ...l.recentAgents.filter(k => k !== kind)],
        }))
      onStarted(next, chat)
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  const [go, going] = chat ? (['ns.start', 'ns.starting'] as const) : (['ns.open', 'ns.opening'] as const)
  const summary = (agent: string, p: Target) => {
    const at = { path: p.display, machine: p.machine }
    if (chat) return t('ns.starts', { agent, ...at })
    return agent === SHELL ? t('ns.opensShell', at) : t('ns.startsTerminal', { agent, ...at })
  }
  return {
    mode,
    chat,
    setMode: (m: Mode) => {
      setMode(m)
      setChosen(null)
    },
    inDir,
    toDir: () => setWhere('dir'),
    toProject: () => setWhere('project'),
    startable,
    key,
    pickProject: (k: string | null) => {
      setKey(k)
      setChosen(null)
    },
    online,
    mid,
    setPicked,
    dir,
    setDir,
    fresh,
    helps,
    machine,
    kinds,
    offered,
    kind,
    setChosen,
    task,
    setTask,
    /** Something to start, with what to start it. */
    ready: !!target && !!kind,
    busy,
    error,
    start,
    /** What starting does, or what is missing; or what went wrong. */
    status: error ?? (target && kind ? summary(kind, target) : t(inDir ? 'ns.typeDir' : 'ns.chooseProject')),
    goLabel: t(busy ? going : go),
  }
}
