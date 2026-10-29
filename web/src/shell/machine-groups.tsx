// The projects by the machine they are on, as the computer's sidebar and the phone's drawer list
// them: each machine's name heading its projects with its state, folded to the heading on a tap.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../core/i18n'
import { toggleFolded, useLocal } from '../core/prefs'
import type { Project } from '../model/projects'
import type { MachineEntry } from '../model/space'
import { projectHref } from '../utils/hrefs'
import type { Here } from './common'
import { AskBadge, asking, MachineDot } from './marks'

type Props = {
  projects: Project[]
  machines: MachineEntry[]
  here: Here
  /** Rows sized for a finger, the fold's chevron always in sight, there being no hover. */
  touch?: boolean
  /** A link was followed. */
  onGo?: () => void
}

// The row the page is on.
const ON = 'bg-accent-soft'

export function MachineGroups({ projects, machines, here, touch = false, onGo }: Props) {
  return machines.map(m => (
    <MachineGroup
      key={m.state.machine.id}
      entry={m}
      projects={projects.filter(p => p.mid === m.state.machine.id)}
      here={here}
      touch={touch}
      onGo={onGo}
    />
  ))
}

type GroupProps = {
  entry: MachineEntry
  projects: Project[]
  here: Here
  touch: boolean
  onGo?: (() => void) | undefined
}

/** A machine's name heading its projects, with its state; folded to the heading on a click. */
function MachineGroup({ entry, projects, here, touch, onGo }: GroupProps) {
  const t = useI18n()
  const { state, online } = entry
  const id = state.machine.id
  const folded = useLocal().layout.folded.includes(id)
  const herdr = state.herdr.status
  const note = !online ? t('side.offline') : herdr === 'ready' ? '' : t(`side.herdr.${herdr}`)
  // Folded, the heading still says how many ask.
  const n = online ? projects.reduce((sum, p) => sum + asking(p), 0) : 0
  const Chevron = folded ? ChevronRight : ChevronDown
  return (
    <section className="mt-3 flex flex-col first:mt-1">
      <button
        type="button"
        onClick={() => toggleFolded(id)}
        aria-expanded={!folded}
        className={`group flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${touch ? 'h-11 active:bg-raised' : 'h-7 hover:bg-raised'}`}
      >
        <MachineDot online={online} ready={herdr === 'ready'} />
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-muted">{state.machine.name}</span>
        {note ? <span className="min-w-0 truncate text-[11px] text-faint">· {note}</span> : null}
        <span className="flex-1" />
        {folded && n ? <AskBadge n={n} label={t('side.asking', { n })} /> : null}
        <Chevron
          size={13}
          className={`flex-none text-faint ${touch ? '' : 'opacity-0 group-hover:opacity-100'}`}
        />
      </button>
      {folded
        ? null
        : projects.map(p => (
            <ProjectRow key={p.key} project={p} on={here.project?.key === p.key} touch={touch} onGo={onGo} />
          ))}
    </section>
  )
}

/** A project: how many of its agents ask, and whether any is at work. */
function ProjectRow({
  project: p,
  on,
  touch,
  onGo,
}: {
  project: Project
  on: boolean
  touch: boolean
  onGo?: (() => void) | undefined
}) {
  const t = useI18n()
  const n = p.online ? asking(p) : 0
  const working = p.online && p.sessions.some(s => s.status === 'working')
  const size = touch
    ? 'min-h-11 rounded-lg px-2.5 active:bg-raised'
    : 'min-h-[30px] rounded-md px-2 hover:bg-raised'
  return (
    <Link
      to={projectHref(p.key)}
      onClick={onGo}
      className={`flex items-center gap-2 text-text no-underline focus-visible:outline-2 focus-visible:outline-accent ${size} ${on ? ON : ''} ${p.online ? '' : 'opacity-60'}`}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
      {working ? (
        <span
          title={t('status.working')}
          className="size-[7px] flex-none animate-pulse rounded-full bg-accent motion-reduce:animate-none"
        />
      ) : null}
      {n ? <AskBadge n={n} label={t('side.asking', { n })} /> : null}
    </Link>
  )
}
