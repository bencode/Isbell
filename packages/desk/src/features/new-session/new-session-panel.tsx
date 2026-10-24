// New session: a panel with room for a real task. Replying to a running session happens on its page.

import { startAgent } from '@isbell/core'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { SidePanel } from '../../components/panel'
import { SelectBox } from '../../components/select'
import { errorText, useT } from '../../core/i18n'
import { getLocal, updateLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { sessionHref } from '../../utils/hrefs'
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
  const [chosen, setChosen] = useState<string | null>(null)
  const last = project ? getLocal().lastAgent[project.key] : undefined
  const kind = [chosen, last, kinds[0]].find(k => k && kinds.includes(k)) ?? null
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const start = async () => {
    if (!project || !kind || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const prompt = task.trim()
      const started = await startAgent(space.call, project.mid, {
        cwd: project.path,
        kind,
        ...(prompt ? { prompt } : {}),
      })
      updateLocal(l => ({
        lastAgent: { ...l.lastAgent, [project.key]: kind },
        recentAgents: [kind, ...l.recentAgents.filter(k => k !== kind)],
      }))
      onOpenChange(false)
      navigate(sessionHref(project.mid, started.paneId), { state: { promptError: started.promptError } })
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  const machines = [...new Set(startable.map(p => p.machine))]
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
              t('ns.starts', { agent: kind, path: project.display, machine: project.machine })
            ) : (
              t('ns.chooseProject')
            )}
          </span>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={start} disabled={!project || !kind || busy}>
            {busy ? t('ns.starting') : t('ns.start')}
            <span className="font-mono text-[11px] opacity-70">⌘↵</span>
          </Button>
        </>
      }
    >
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
            groups={
              project
                ? [
                    {
                      label: t('ns.installed', { machine: project.machine }),
                      options: kinds.map(k => ({ value: k, label: k })),
                    },
                  ]
                : []
            }
          />
        </label>
      </div>
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
    </SidePanel>
  )
}
