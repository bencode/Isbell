// The sidebar every page keeps: the projects by the machine they are on, with what needs you in
// each, a way to start in a new directory, and the state of the machines and the relay. The agents
// themselves are on the board. Folded into a rail, see rail.tsx.

import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
} from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { toggleFolded, toggleRail, useLocal } from '../../core/prefs'
import type { ConnStatus } from '../../model/connection'
import { needs, type Project } from '../../model/projects'
import type { MachineEntry } from '../../model/space'
import { projectHref } from '../../utils/hrefs'
import { COMMAND_KEY } from '../../utils/shortcuts'
import type { Here } from '../common'
import { AskBadge, asking, MachineDot, RelayStatus } from '../marks'

export type SideProps = {
  projects: Project[]
  machines: MachineEntry[]
  status: ConnStatus
  here: Here
  onSettings: () => void
  /** Opens the palette. */
  onCommand: () => void
}

const ROW =
  'flex min-h-[30px] items-center gap-2 rounded-md px-2 text-text no-underline hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent'
// The row the page is on.
const ON = 'bg-accent-soft'

export function Sidebar({
  projects,
  machines,
  status,
  here,
  onSettings,
  onCommand,
  onNewDir,
}: SideProps & { onNewDir: () => void }) {
  const t = useI18n()
  const total = needs(projects).length
  return (
    <nav
      aria-label={t('side.projects')}
      className="flex w-64 flex-none flex-col border-r border-line bg-side"
    >
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
        <span className="flex-1 text-[15px] font-bold">Isbell</span>
      </div>
      <button
        type="button"
        onClick={onCommand}
        className="mx-2.5 mb-2 flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-left text-[13px] text-faint hover:border-line-strong hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Search size={15} />
        <span className="flex-1 truncate">{t('side.search')}</span>
        <kbd className="rounded border border-line px-1 font-mono text-[11px]">{COMMAND_KEY}</kbd>
      </button>
      <div className="px-2">
        <Link to="/" className={`${ROW} ${here.project || here.pane ? '' : ON}`}>
          <LayoutGrid size={16} className="text-muted" />
          <span className="flex-1 font-medium">{t('side.all')}</span>
          {total ? <AskBadge n={total} label={t('needs.title')} /> : null}
        </Link>
      </div>
      <div className="flex items-center justify-between pt-3.5 pr-2.5 pb-1 pl-4">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
          {t('side.projects')}
        </span>
        <button
          type="button"
          onClick={onNewDir}
          aria-label={t('side.add')}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised hover:text-text"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {/* In the order of the projects, so the number keys count down the sidebar. */}
        {machines.map(m => (
          <MachineGroup
            key={m.state.machine.id}
            entry={m}
            projects={projects.filter(p => p.mid === m.state.machine.id)}
            here={here}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-line p-2">
        <RelayStatus status={status} />
        <div className="mt-1 flex items-center">
          <Button variant="quiet" className="flex-1" onClick={onSettings}>
            <Settings2 size={15} />
            {t('side.settings')}
          </Button>
          <Button variant="quiet" size="icon" onClick={toggleRail} aria-label={t('side.collapse')}>
            <ChevronsLeft size={16} />
          </Button>
        </div>
      </div>
    </nav>
  )
}

/** A machine's name heading its projects, with its state; folded to the heading on a click. */
function MachineGroup({ entry, projects, here }: { entry: MachineEntry; projects: Project[]; here: Here }) {
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
        className="group flex h-7 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <MachineDot online={online} ready={herdr === 'ready'} />
        <span className="min-w-0 truncate text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">
          {state.machine.name}
        </span>
        {note ? <span className="min-w-0 truncate text-[11px] text-faint">· {note}</span> : null}
        <span className="flex-1" />
        {folded && n ? <AskBadge n={n} label={t('side.asking', { n })} /> : null}
        <Chevron size={13} className="flex-none text-faint opacity-0 group-hover:opacity-100" />
      </button>
      {folded
        ? null
        : projects.map(p => <ProjectRow key={p.key} project={p} on={here.project?.key === p.key} />)}
    </section>
  )
}

/** A project: how many of its agents ask, and whether any is at work. */
function ProjectRow({ project: p, on }: { project: Project; on: boolean }) {
  const t = useI18n()
  const n = p.online ? asking(p) : 0
  const working = p.online && p.sessions.some(s => s.status === 'working')
  return (
    <Link to={projectHref(p.key)} className={`${ROW} ${on ? ON : ''} ${p.online ? '' : 'opacity-60'}`}>
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
