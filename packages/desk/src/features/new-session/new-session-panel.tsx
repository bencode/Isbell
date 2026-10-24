// New: an agent to chat with, given a real task, or a terminal, with an agent in it or a plain
// shell. Replying to a running session happens on its page.

import { openShell, type Project, type Space, type Started, startAgent } from '@isbell/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { SidePanel } from '../../components/panel'
import { Segmented } from '../../components/segmented'
import { SelectBox } from '../../components/select'
import { errorText, useT } from '../../core/i18n'
import { getLocal, updateLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { sessionHref, terminalHref } from '../../utils/hrefs'
import { onSubmitKey } from '../../utils/shortcuts'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  focusedKey: string | undefined
  onAddProject: () => void
}

export function NewSession({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts from the focused project.
  return open ? <Form {...props} /> : null
}

type Mode = 'chat' | 'terminal'
/** The agent choice that starts no agent: a plain shell. Agent kinds never contain ':'. */
const SHELL = ':shell'

/** Starts what the form describes and says where to go next. */
async function launch(
  space: Space,
  project: Project,
  mode: Mode,
  kind: string,
  prompt: string,
): Promise<{ href: string; state?: { promptError?: Started['promptError'] } }> {
  const { mid, path } = project
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

function Form({ onOpenChange, focusedKey, onAddProject }: Omit<Props, 'open'>) {
  const t = useT()
  const space = useSpace()
  const view = useSpaceView()
  const projects = useProjects()
  const navigate = useNavigate()
  const startable = projects.filter(p => p.online && p.path)
  const [key, setKey] = useState(startable.some(p => p.key === focusedKey) ? (focusedKey ?? null) : null)
  const project = startable.find(p => p.key === key)
  const kinds = project
    ? agentsFor(
        view.machines.find(m => m.state.machine.id === project.mid)?.state.caps.agentKinds ?? [],
        getLocal().recentAgents,
      )
    : []
  const [mode, setMode] = useState<Mode>('chat')
  const chat = mode === 'chat'
  const [chosen, setChosen] = useState<string | null>(null)
  const last = project ? getLocal().lastAgent[project.key] : undefined
  // A chat falls back to the agent used last; a terminal opens a plain shell unless an agent is picked.
  const pickable = chat ? kinds : [...kinds, SHELL]
  const kind = [chosen, ...(chat ? [last, kinds[0]] : [SHELL])].find(k => k && pickable.includes(k)) ?? null
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const start = async () => {
    if (!project || !kind || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const next = await launch(space, project, mode, kind, task.trim())
      if (kind !== SHELL)
        updateLocal(l => ({
          lastAgent: { ...l.lastAgent, [project.key]: kind },
          recentAgents: [kind, ...l.recentAgents.filter(k => k !== kind)],
        }))
      onOpenChange(false)
      navigate(next.href, { state: next.state })
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  const machines = [...new Set(startable.map(p => p.machine))]
  const [go, going] = chat ? (['ns.start', 'ns.starting'] as const) : (['ns.open', 'ns.opening'] as const)
  const summary = (agent: string, p: Project) => {
    const at = { path: p.display, machine: p.machine }
    if (chat) return t('ns.starts', { agent, ...at })
    return agent === SHELL ? t('ns.opensShell', at) : t('ns.startsTerminal', { agent, ...at })
  }
  const installed = project
    ? [
        {
          label: t('ns.installed', { machine: project.machine }),
          options: kinds.map(k => ({ value: k, label: k })),
        },
      ]
    : []
  const plain =
    project && !chat ? [{ label: t('ns.plain'), options: [{ value: SHELL, label: t('ns.shell') }] }] : []
  return (
    <SidePanel
      open
      onOpenChange={onOpenChange}
      title={t('ns.title')}
      closeLabel={t('close')}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : project && kind ? (
              summary(kind, project)
            ) : (
              t('ns.chooseProject')
            )}
          </span>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={start} disabled={!project || !kind || busy}>
            {t(busy ? going : go)}
            {chat ? <span className="font-mono text-[11px] opacity-70">⌘↵</span> : null}
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
                onClick={onAddProject}
                className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm text-accent hover:bg-raised"
              >
                <Plus size={15} />
                {t('ns.addProject')}
              </button>
            }
          />
        </label>
        <label className="flex flex-col gap-1.5" htmlFor="ns-agent">
          <span className="text-[13px] font-semibold">{t('ns.agent')}</span>
          <SelectBox
            id="ns-agent"
            value={kind}
            onChange={setChosen}
            disabled={!project}
            placeholder={project ? t('ns.noAgents', { machine: project.machine }) : '—'}
            groups={[...installed, ...plain]}
          />
        </label>
      </div>
      {chat ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('ns.task')}</span>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the panel opens to write the task.
            autoFocus={Boolean(project)}
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
