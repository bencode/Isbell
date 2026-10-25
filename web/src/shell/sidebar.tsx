// The sidebar every page keeps: a way to start something, the projects with what runs in them,
// and the state of the machines and the relay. Folded into a rail, see rail.tsx.

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
import { Button } from '../components/button'
import { useI18n } from '../core/i18n'
import { toggleFolded, toggleRail, useLocal } from '../core/prefs'
import type { ConnStatus } from '../model/connection'
import { needs, type Project, paneKey } from '../model/projects'
import type { MachineEntry } from '../model/space'
import { projectHref, sessionHref, terminalHref } from '../utils/hrefs'
import { since, useNow } from '../utils/time'
import { AskBadge, asking, MachineDot, RelayStatus, StatusDot } from './marks'

/** Where the route points: a project's board, or a pane (by `paneKey`) inside some project. */
export type Here = { project: Project | undefined; pane: string | undefined }

export type SideProps = {
  projects: Project[]
  machines: MachineEntry[]
  status: ConnStatus
  here: Here
  onNew: () => void
  onSettings: () => void
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
  onNew,
  onSettings,
  onAddProject,
}: SideProps & { onAddProject: () => void }) {
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
        <Button variant="primary" size="small" onClick={onNew}>
          <Plus size={15} />
          {t('app.newSession')}
        </Button>
      </div>
      <button
        type="button"
        disabled
        title={t('side.searchSoon')}
        className="mx-2.5 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-left text-[13px] text-faint"
      >
        <Search size={15} />
        <span className="flex-1 truncate">{t('side.search')}</span>
        <kbd className="rounded border border-line px-1 font-mono text-[11px]">⌘K</kbd>
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
          onClick={onAddProject}
          aria-label={t('side.add')}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised hover:text-text"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {projects.map(p => (
          <ProjectTree key={p.key} project={p} here={here} />
        ))}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-line p-2">
        <span className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
          {t('side.machines')}
        </span>
        {machines.map(({ state, online }) => {
          const herdr = state.herdr.status
          const note = !online ? t('side.offline') : herdr === 'ready' ? '' : t(`side.herdr.${herdr}`)
          return (
            <span key={state.machine.id} className="flex items-center gap-2.5 px-2 py-0.5 text-[13px]">
              <MachineDot online={online} ready={herdr === 'ready'} />
              <span className="min-w-0 flex-1 truncate">{state.machine.name}</span>
              {note ? <span className="text-xs text-faint">{note}</span> : null}
            </span>
          )
        })}
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

/** A project, and unless folded, its sessions and then its shells. */
function ProjectTree({ project: p, here }: { project: Project; here: Here }) {
  const t = useI18n()
  const now = useNow()
  const { folded, terminal } = useLocal().layout
  const open = !folded.includes(p.key)
  const n = asking(p)
  const inside = here.project?.key === p.key
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <div className={`${ROW} pl-0.5 ${inside && (!here.pane || !open) ? ON : ''}`}>
        <button
          type="button"
          onClick={() => toggleFolded(p.key)}
          aria-expanded={open}
          aria-label={t(open ? 'side.hide' : 'side.show')}
          className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent text-faint hover:text-text"
        >
          <Chevron size={14} />
        </button>
        <Link to={projectHref(p.key)} className="min-w-0 flex-1 truncate text-text no-underline">
          <span className="font-semibold">{p.name}</span>{' '}
          <span className="text-xs text-faint">
            {p.machine}
            {p.online ? '' : ` · ${t('side.offline')}`}
          </span>
        </Link>
        {n ? (
          <AskBadge n={n} label={t('side.asking', { n })} />
        ) : p.sessions.length ? (
          <span className="pr-1 text-xs text-faint">{p.sessions.length}</span>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-col pl-[22px]">
          {p.sessions.map(s => (
            <Link
              key={s.paneId}
              to={(terminal.includes(paneKey(s.mid, s.paneId)) ? terminalHref : sessionHref)(s.mid, s.paneId)}
              className={`${ROW} min-h-[27px] text-[13px] ${here.pane === paneKey(s.mid, s.paneId) ? ON : ''}`}
            >
              <StatusDot status={s.status} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs text-faint">{since(s.statusSince, now)}</span>
            </Link>
          ))}
          {p.shells.map(s => (
            <Link
              key={s.paneId}
              to={terminalHref(s.mid, s.paneId)}
              title={s.title}
              className={`${ROW} min-h-[27px] text-[13px] ${here.pane === paneKey(s.mid, s.paneId) ? ON : ''}`}
            >
              <SquareTerminal size={13} className="flex-none text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.paneId}</span>
              <span className="text-xs text-faint">{t('side.shell')}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  )
}
