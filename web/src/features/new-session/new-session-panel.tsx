// New: in a project or in a directory that is not one yet, an agent to chat with, given a real task,
// or a terminal, with an agent in it or a plain shell. Starting there is what makes the directory a
// project. Replying to a running session happens on its page.

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { SidePanel } from '../../components/panel'
import { Segmented } from '../../components/segmented'
import { SelectBox } from '../../components/select'
import { errorText, useI18n } from '../../core/i18n'
import { getLocal, updateLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { openShell, type Started, startAgent } from '../../model/herdr'
import { projectKey } from '../../model/projects'
import { machineOf, type Space } from '../../model/space'
import { sessionHref, terminalHref } from '../../utils/hrefs'
import { onSubmitKey } from '../../utils/shortcuts'
import { useNewDir } from './dir-input'
import { NewDirField } from './new-dir'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  focusedKey: string | undefined
  /** Open on a new directory rather than on the projects there are. */
  newDir: boolean
}

export function NewSession({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts from the focused project.
  return open ? <Form {...props} /> : null
}

type Mode = 'chat' | 'terminal'
/** The agent choice that starts no agent: a plain shell. Agent kinds never contain ':'. */
const SHELL = ':shell'

/** Where to start: a directory on a machine, and how to show it. */
type Target = { mid: string; path: string; machine: string; display: string }

/** Starts what the form describes and says where to go next. */
async function launch(
  space: Space,
  { mid, path }: Target,
  mode: Mode,
  kind: string,
  prompt: string,
): Promise<{ href: string; state?: { promptError?: Started['promptError'] } }> {
  if (kind === SHELL) {
    const paneId = await openShell(space.openThenEnd, mid, path)
    await space.refreshShells(mid)
    return { href: terminalHref(mid, paneId) }
  }
  const started = await startAgent(space.call, mid, {
    cwd: path,
    kind,
    ...(mode === 'chat' && prompt ? { prompt } : {}),
  })
  return mode === 'chat'
    ? { href: sessionHref(mid, started.paneId), state: { promptError: started.promptError } }
    : { href: terminalHref(mid, started.paneId) }
}

function agentsFor(kinds: string[], recent: string[]) {
  const rank = (k: string) => (recent.includes(k) ? recent.indexOf(k) : recent.length)
  return [...kinds].sort((a, b) => rank(a) - rank(b))
}

function Form({ onOpenChange, focusedKey, newDir }: Omit<Props, 'open'>) {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const navigate = useNavigate()
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
  const [chosen, setChosen] = useState<string | null>(null)
  const last = target ? getLocal().lastAgent[projectKey(target.mid, target.path)] : undefined
  // A chat falls back to the agent used last; a terminal opens a plain shell unless an agent is picked.
  const pickable = chat ? kinds : [...kinds, SHELL]
  const kind = [chosen, ...(chat ? [last, kinds[0]] : [SHELL])].find(k => k && pickable.includes(k)) ?? null
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
      onOpenChange(false)
      // A chat joins the board, which stays where it is; a terminal opens to work in, and a task that
      // did not reach the agent shows on its page.
      if (!chat || next.state?.promptError) navigate(next.href, { state: next.state })
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  // What was asked for is already starting on the machine; the panel stays until it is.
  const close = (open: boolean) => {
    if (!busy) onOpenChange(open)
  }
  const machines = [...new Set(startable.map(p => p.machine))]
  const [go, going] = chat ? (['ns.start', 'ns.starting'] as const) : (['ns.open', 'ns.opening'] as const)
  const summary = (agent: string, p: Target) => {
    const at = { path: p.display, machine: p.machine }
    if (chat) return t('ns.starts', { agent, ...at })
    return agent === SHELL ? t('ns.opensShell', at) : t('ns.startsTerminal', { agent, ...at })
  }
  const installed = machine
    ? [
        {
          label: t('ns.installed', { machine: machine.name }),
          options: kinds.map(k => ({ value: k, label: k })),
        },
      ]
    : []
  const plain =
    machine && !chat ? [{ label: t('ns.plain'), options: [{ value: SHELL, label: t('ns.shell') }] }] : []
  return (
    <SidePanel
      open
      onOpenChange={close}
      title={t('ns.title')}
      closeLabel={t('close')}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : target && kind ? (
              summary(kind, target)
            ) : (
              t(inDir ? 'ns.typeDir' : 'ns.chooseProject')
            )}
          </span>
          <Button variant="quiet" onClick={() => close(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={start} disabled={!target || !kind || busy}>
            {t(busy ? going : go)}
            {chat ? <span className="font-mono text-[11px] opacity-70">↵</span> : null}
          </Button>
        </>
      }
    >
      {/* A block wrapper, so the switch keeps its own width in the panel's column. */}
      <div>
        <Segmented
          value={mode}
          onChange={m => {
            setMode(m)
            setChosen(null)
          }}
          label={t('ns.mode')}
          segments={[
            { value: 'chat', label: t('ns.chat') },
            { value: 'terminal', label: t('ns.terminal') },
          ]}
        />
      </div>
      <div className="grid grid-cols-[1fr_180px] gap-3">
        {inDir ? (
          <NewDirField
            machines={online}
            mid={mid}
            onMid={setPicked}
            value={dir}
            onChange={setDir}
            typed={fresh}
            helps={helps}
            onBack={startable.length ? () => setWhere('project') : undefined}
          />
        ) : (
          <label className="flex flex-col gap-1.5" htmlFor="ns-project">
            <span className="text-[13px] font-semibold">{t('ns.project')}</span>
            <SelectBox
              id="ns-project"
              value={key}
              onChange={v => {
                setKey(v)
                setChosen(null)
              }}
              placeholder={t('ns.chooseProject')}
              groups={machines.map(m => ({
                label: m,
                options: startable
                  .filter(p => p.machine === m)
                  .map(p => ({ value: p.key, label: p.name, hint: p.display })),
              }))}
              extra={
                <button
                  type="button"
                  onClick={() => setWhere('dir')}
                  className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm text-accent hover:bg-raised"
                >
                  <Plus size={15} />
                  {t('ns.newDir')}
                </button>
              }
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5" htmlFor="ns-agent">
          <span className="text-[13px] font-semibold">{t('ns.agent')}</span>
          <SelectBox
            id="ns-agent"
            value={kind}
            onChange={setChosen}
            disabled={!machine}
            placeholder={machine ? t('ns.noAgents', { machine: machine.name }) : '—'}
            groups={[...installed, ...plain]}
          />
        </label>
      </div>
      {chat ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('ns.task')}</span>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the panel opens to write the task.
            autoFocus={!inDir && Boolean(project)}
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={onSubmitKey(() => void start())}
            placeholder={t('ns.placeholder')}
            className="min-h-[260px] resize-y rounded-lg border border-line bg-bg px-3.5 py-3 text-sm leading-relaxed text-text outline-none focus:outline-2 focus:outline-accent"
          />
        </label>
      ) : null}
    </SidePanel>
  )
}
