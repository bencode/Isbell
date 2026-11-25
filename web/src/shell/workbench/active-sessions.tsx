// The right column's Agents: every agent on the machines online, whichever project it is in, by what
// it asks of you: asking, then working, then the latest finished, those finished earlier and those
// standing by folded. An agent with a role shows it, and comes with the running agent it reports to,
// as a team under the most urgent of them. Opening one looks at it over the workspace, unless it is
// the tab on screen.

import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useBooks } from '../../core/books'
import { type Key, useI18n } from '../../core/i18n'
import {
  type Layout,
  markAllSeen,
  setActiveFilter,
  toggleFinished,
  toggleIdle,
  useLocal,
} from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Placed, type Project, paneKey } from '../../model/projects'
import { clustered, LANES, type Lane, type Member, type Placing, roleOf, teams } from '../../model/roles'
import { keysIn, usePinned } from '../../utils/held-order'
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

/** The parts of the column shown as cards; the others are lines. */
const CARDS: ReadonlySet<Lane> = new Set(['asking', 'running', 'latest'])

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
  const live = lanes(projects)
  const { peek, open } = usePeek()
  const shared = sharedNames(projects)
  const books = useBooks()
  const { runs } = useSpaceView()

  const finishedNow = [...live.finished].reverse()
  const lanesNow: Record<Lane, Placed[]> = {
    asking: live.asking,
    running: live.running,
    latest: finishedNow.slice(0, LATEST_FINISHED),
    earlier: finishedNow.slice(LATEST_FINISHED),
    standing: live.standing,
  }
  const roleFor = ({ session }: Placed) => {
    const run = runs[session.mid]?.[session.paneId]
    const book = books[session.mid]?.roles
    return run && book ? roleOf(book, run) : undefined
  }
  const members: Member[] = LANES.flatMap(lane =>
    lanesNow[lane].map(p => {
      const role = roleFor(p)
      return { key: keyOf(p), lane, ...(role ? { role } : {}) }
    }),
  )
  const placings = new Map<string, Placing>(teams(members).map(p => [p.key, p]))
  const roles = new Map(members.flatMap(m => (m.role ? [[m.key, m.role.name] as const] : [])))
  const ownLane = new Map(members.map(m => [m.key, m.lane]))
  // The one looked at stays in the part and place it was opened from, as looking marks it seen.
  const slots = usePinned(
    members.map(m => ({ key: m.key, group: placings.get(m.key)?.lane ?? m.lane })),
    peek ? paneKey(peek.mid, peek.paneId) : undefined,
  )
  const placedBy = new Map(LANES.flatMap(lane => lanesNow[lane].map(p => [keyOf(p), p] as const)))
  const laneOf = (lane: Lane) =>
    clustered(keysIn(slots, lane), placings).flatMap(key => placedBy.get(key) ?? [])
  const asking = laneOf('asking')
  const running = laneOf('running')
  const latest = laneOf('latest')
  const earlier = laneOf('earlier')
  const standing = laneOf('standing')
  const finished = [...latest, ...earlier]
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
      onOpen: (terminal?: boolean) => open(placed, terminal),
    }
  }
  // Each shows as its own part does, a card or a line, wherever its team puts it; set in under its
  // lead when it is not one.
  const shown = (list: Placed[]) =>
    list.map(p => {
      const key = keyOf(p)
      const placing = placings.get(key)
      const name = roles.get(key)
      const role = name ? { name, ...(placing?.via ? { via: placing.via } : {}) } : undefined
      const own = ownLane.get(key)
      const item =
        own && CARDS.has(own) ? (
          <ActiveCard key={key} role={role} {...propsOf(p)} />
        ) : (
          <StandingRow key={key} role={role} {...propsOf(p)} />
        )
      return placing?.depth ? (
        <div
          key={key}
          className="relative ml-4 flex flex-none flex-col before:absolute before:top-[-6px] before:-left-[9px] before:h-[20px] before:w-[7px] before:rounded-bl-[5px] before:border-b before:border-l before:border-line-strong"
        >
          {item}
        </div>
      ) : (
        item
      )
    })
  const seeAll = () => {
    markAllSeen(finished.map(p => ({ key: keyOf(p), since: p.session.statusSince })))
  }

  const sections = [
    shows('blocked') && asking.length ? (
      <Section key="asking" title={t('active.waiting')} count={asking.length}>
        {shown(asking)}
      </Section>
    ) : null,
    shows('working') && running.length ? (
      <Section key="running" title={t('active.running')} count={running.length}>
        {shown(running)}
      </Section>
    ) : null,
    shows('finished') && finished.length ? (
      <Section key="finished" title={t('active.finished')} count={finished.length}>
        {shown(latest)}
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
        {finishedOpen || !all ? shown(earlier) : null}
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
        {idleOpen || !all ? shown(standing) : null}
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
