// The right column: every session on the machines online, whichever project it is in, by what it
// asks of you: asking, then working, then the latest finished, those finished earlier and those
// standing by folded. Opening one looks at it over the workspace, unless it is the tab on screen.

import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { type Key, useI18n } from '../../core/i18n'
import {
  type Layout,
  markAllSeen,
  setActiveFilter,
  toggleFinished,
  toggleIdle,
  useLocal,
} from '../../core/prefs'
import { useProjects } from '../../core/space'
import { lanes, type Placed, type Project, paneKey } from '../../model/projects'
import { useNow } from '../../utils/time'
import { ActiveCard, StandingRow } from './active-card'
import { usePeek } from './peek'

type Filter = Layout['activeFilter']

const FILTERS: { value: Filter; label: Key }[] = [
  { value: 'all', label: 'active.all' },
  { value: 'blocked', label: 'active.waiting' },
  { value: 'working', label: 'active.running' },
  { value: 'finished', label: 'active.finished' },
  { value: 'idle', label: 'active.idle' },
]

/** How many of those finished show as cards. */
const LATEST_FINISHED = 3

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

/** The names of projects open on more than one machine. */
function sharedNames(projects: Project[]) {
  const machines = new Map<string, Set<string>>()
  for (const p of projects.filter(p => p.online && p.sessions.length)) {
    const name = p.configured ? p.name : p.display
    machines.set(name, (machines.get(name) ?? new Set()).add(p.mid))
  }
  return new Set([...machines].filter(([, mids]) => mids.size > 1).map(([name]) => name))
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <>
      <h3 className="m-0 px-1 pt-2 text-[11.5px] font-semibold text-faint first:pt-0.5">
        {title}
        <span className="ml-1 font-mono font-medium">{count}</span>
      </h3>
      {children}
    </>
  )
}

function Fold({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-[26px] min-w-0 flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 text-left text-[12.5px] text-muted hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {label}
    </button>
  )
}

export function ActiveSessions() {
  const t = useI18n()
  const now = useNow()
  const { activeFilter: filter, idleOpen, finishedOpen } = useLocal().layout
  const projects = useProjects()
  const { asking, finished: oldestFirst, running, standing } = lanes(projects)
  const { peek, open } = usePeek()
  const shared = sharedNames(projects)

  const finished = [...oldestFirst].reverse()
  const latest = finished.slice(0, LATEST_FINISHED)
  const earlier = finished.slice(LATEST_FINISHED)
  const counts: Record<Filter, number> = {
    all: asking.length + running.length + finished.length + standing.length,
    blocked: asking.length,
    working: running.length,
    finished: finished.length,
    idle: standing.length,
  }
  const all = filter === 'all'
  const shows = (lane: Filter) => all || filter === lane

  const propsOf = (placed: Placed) => {
    const { mid, paneId } = placed.session
    return {
      placed,
      now,
      peeking: peek?.mid === mid && peek.paneId === paneId,
      sharedName: shared.has(placed.project.configured ? placed.project.name : placed.project.display),
      onOpen: (terminal: boolean) => open(placed, terminal),
    }
  }
  const cards = (list: Placed[]) => list.map(p => <ActiveCard key={keyOf(p)} {...propsOf(p)} />)
  const lines = (list: Placed[]) => list.map(p => <StandingRow key={keyOf(p)} {...propsOf(p)} />)
  const seeAll = () => markAllSeen(finished.map(p => ({ key: keyOf(p), since: p.session.statusSince })))

  const sections = [
    shows('blocked') && asking.length ? (
      <Section key="asking" title={t('active.waiting')} count={asking.length}>
        {cards(asking)}
      </Section>
    ) : null,
    shows('working') && running.length ? (
      <Section key="running" title={t('active.running')} count={running.length}>
        {cards(running)}
      </Section>
    ) : null,
    shows('finished') && finished.length ? (
      <Section key="finished" title={t('active.finished')} count={finished.length}>
        {cards(latest)}
        <div className="flex min-w-0 items-center gap-1">
          {earlier.length && all ? (
            <Fold
              open={finishedOpen}
              label={t('active.olderFinished', { n: earlier.length })}
              onToggle={toggleFinished}
            />
          ) : null}
          <button
            type="button"
            onClick={seeAll}
            className="ml-auto h-[26px] flex-none cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-xs text-faint hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t('active.markAllSeen')}
          </button>
        </div>
        {finishedOpen || !all ? lines(earlier) : null}
      </Section>
    ) : null,
    shows('idle') && standing.length ? (
      <Section key="standing" title={t('active.idle')} count={standing.length}>
        {all ? (
          <Fold
            open={idleOpen}
            label={t(idleOpen ? 'sessions.fold' : 'active.expand')}
            onToggle={toggleIdle}
          />
        ) : null}
        {idleOpen || !all ? lines(standing) : null}
      </Section>
    ) : null,
  ].filter(Boolean)

  return (
    <>
      <div className="flex flex-none flex-wrap gap-0.5 px-2 pt-2 pb-1.5">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setActiveFilter(value)}
            className={`h-6 cursor-pointer rounded-md border-0 px-2 text-xs whitespace-nowrap transition-colors duration-75 hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${filter === value ? 'bg-selected font-medium text-text' : 'bg-transparent text-muted hover:bg-hover'}`}
          >
            {t(label)}
            <span className="ml-1 font-normal text-faint">{counts[value]}</span>
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-2 pt-0.5 pb-3.5">
        {sections.length ? (
          sections
        ) : (
          <p className="m-0 px-2 py-2.5 text-[13px] text-muted">{t('active.none')}</p>
        )}
      </div>
    </>
  )
}
