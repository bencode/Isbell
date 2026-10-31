// The projects by the machine they are on, as the computer's sidebar and the phone's drawer list
// them: each machine's name heading its projects with its state, folded to the heading on a tap.
// After the projects with something running, the computer's sidebar lists those with only recorded
// sessions, the latest few, the rest a click away.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../core/i18n'
import { toggleFolded, toggleOlder, useLocal } from '../core/prefs'
import { hasPanes, type Project } from '../model/projects'
import type { MachineEntry } from '../model/space'
import { projectHref, projectSessionsHref } from '../utils/hrefs'
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
/** The projects with nothing running listed before the rest are folded away. */
const LATEST = 5

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
  const { folded: foldedIds, older: olderIds } = useLocal().layout
  const folded = foldedIds.includes(id)
  // A phone lists only what runs.
  const running = projects.filter(hasPanes)
  const idle = touch ? [] : projects.filter(p => !hasPanes(p))
  const shown = olderIds.includes(id) ? idle : idle.slice(0, LATEST)
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
      {folded ? null : (
        <>
          {[...running, ...shown].map(p => (
            <ProjectRow key={p.key} project={p} on={here.project?.key === p.key} touch={touch} onGo={onGo} />
          ))}
          {idle.length > LATEST ? (
            <button
              type="button"
              onClick={() => toggleOlder(id)}
              aria-expanded={idle.length === shown.length}
              className="flex min-h-[26px] cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-left text-[12.5px] text-faint hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
            >
              {idle.length > shown.length
                ? t('side.older', { n: idle.length - shown.length })
                : t('side.fewer')}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

/** A project: how many of its agents ask, and whether any is at work; with nothing running, faint,
 * leading to its sessions. */
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
  const idle = !hasPanes(p)
  const size = touch
    ? 'min-h-11 rounded-lg px-2.5 active:bg-raised'
    : 'min-h-[30px] rounded-md px-2 hover:bg-raised'
  return (
    <Link
      to={idle ? projectSessionsHref(p.key) : projectHref(p.key)}
      onClick={onGo}
      className={`flex items-center gap-2 text-text no-underline focus-visible:outline-2 focus-visible:outline-accent ${size} ${on ? ON : ''} ${p.online ? '' : 'opacity-60'}`}
    >
      <span className={`min-w-0 flex-1 truncate ${idle ? 'text-faint' : 'font-medium'}`}>{p.name}</span>
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
