// The task box atop the board: give a project a task and an agent starts on it, while the board
// stays where it is and the agent joins it. A shell opens in its terminal; anything more goes to New.

import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { SelectBox } from '../../components/select'
import { errorText, useI18n } from '../../core/i18n'
import { getLocal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { type Project, projectKey } from '../../model/projects'
import { machineOf } from '../../model/space'
import { onSubmitKey } from '../../utils/shortcuts'
import { agentsFor, launch, rememberAgent, SHELL, type Target } from './launch'

type Props = {
  /** The project the board shows; none on all agents, where one is chosen here. */
  project: Project | undefined
  onMore: () => void
}

export function Dispatch({ project: scoped, onMore }: Props) {
  const t = useI18n()
  const space = useSpace()
  const view = useSpaceView()
  const navigate = useNavigate()
  const startable = useProjects().filter(p => p.online && p.path)
  const [key, setKey] = useState<string | null>(null)
  const project = scoped ?? startable.find(p => p.key === key)
  const machine = project ? machineOf(view.machines, project.mid) : undefined
  const ready = !!machine?.online && machine.state.herdr.status === 'ready'
  const kinds = machine ? agentsFor(machine.state.caps.agentKinds, getLocal().recentAgents) : []
  const [chosen, setChosen] = useState<string | null>(null)
  const last = project ? getLocal().lastAgent[projectKey(project.mid, project.path)] : undefined
  const kind = [chosen, last, kinds[0]].find(k => k && kinds.includes(k)) ?? null
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()

  // Why nothing can start here, if it cannot.
  const blocked = !project
    ? scoped || startable.length
      ? undefined
      : t('dispatch.noProject')
    : !project.online
      ? t('project.offline')
      : !project.path
        ? t('files.noRoot')
        : !ready
          ? t('dispatch.notReady', { machine: project.machine })
          : !kinds.length
            ? t('ns.noAgents', { machine: project.machine })
            : undefined
  const target: Target | undefined =
    project && !blocked
      ? { mid: project.mid, path: project.path, machine: project.machine, display: project.display }
      : undefined

  const run = async (what: string, prompt: string) => {
    if (!target || busy) return
    setBusy(true)
    setNote(undefined)
    try {
      const next = await launch(space, target, 'chat', what, prompt)
      if (what === SHELL) navigate(next.href)
      else {
        rememberAgent(target, what)
        setTask('')
        const failed = next.state?.promptError
        if (failed) setNote(t('session.promptFailed', { msg: failed.msg }))
      }
    } catch (err) {
      setNote(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }
  const start = () => {
    if (kind && task.trim()) void run(kind, task.trim())
  }

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2 rounded-xl border border-line bg-raised p-2 shadow-sm">
        {scoped ? null : (
          <div className="w-48 flex-none">
            <SelectBox
              value={key}
              onChange={v => {
                setKey(v)
                setChosen(null)
              }}
              placeholder={t('ns.chooseProject')}
              disabled={!startable.length}
              groups={[...new Set(startable.map(p => p.machine))].map(m => ({
                label: m,
                options: startable
                  .filter(p => p.machine === m)
                  .map(p => ({ value: p.key, label: p.name, hint: p.display })),
              }))}
            />
          </div>
        )}
        <div className="w-36 flex-none">
          <SelectBox
            value={kind}
            onChange={setChosen}
            disabled={!target}
            placeholder={t('ns.agent')}
            groups={[{ options: kinds.map(k => ({ value: k, label: k })) }]}
          />
        </div>
        <textarea
          rows={1}
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={onSubmitKey(start)}
          disabled={!target}
          aria-label={t('ns.task')}
          placeholder={
            blocked ?? t('dispatch.placeholder', { project: project?.name ?? t('dispatch.aProject') })
          }
          className="field-sizing-content max-h-48 min-h-[38px] min-w-0 flex-1 resize-none rounded-md border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-text outline-none focus:outline-2 focus:outline-accent disabled:opacity-60"
        />
        <Button variant="primary" onClick={start} disabled={!target || !kind || !task.trim() || busy}>
          {t(busy ? 'ns.starting' : 'ns.start')}
          <span className="font-mono text-[11px] opacity-70">↵</span>
        </Button>
        <Button
          variant="quiet"
          size="icon"
          onClick={() => void run(SHELL, '')}
          disabled={!target || busy}
          aria-label={t('dispatch.shell')}
          title={t('dispatch.shell')}
        >
          <SquareTerminal size={16} />
        </Button>
        <Button variant="quiet" onClick={onMore}>
          {t('dispatch.more')}
        </Button>
      </div>
      {note ? <p className="m-0 px-1 text-[13px] text-danger">{note}</p> : null}
    </section>
  )
}
