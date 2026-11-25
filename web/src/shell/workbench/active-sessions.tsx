// The right column's Agents: every agent on the machines online, whichever project it is in, under
// its machine, named once there is more than one. An agent with a role shows it, and comes with the running agent it reports to on that
// machine, as a team, its members on a line down from the lead; each machine's teams go by the most
// urgent of them: asking, then working, then finished unseen, then standing by. A machine or a team
// folds away, and stays so. Opening one looks at it over the workspace, unless it is the tab on
// screen.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useBooks } from '../../core/books'
import { type Key, useI18n } from '../../core/i18n'
import { type Layout, markAllSeen, setActiveFilter, toggleAgentFold, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Placed, paneKey } from '../../model/projects'
import { clustered, LANES, type Lane, type Member, type Placing, roleOf, teams } from '../../model/roles'
import { keysIn, usePinned } from '../../utils/held-order'
import { useNow } from '../../utils/time'
import { AgentRow, type Team } from './agent-row'
import { usePeek } from './peek'

type Filter = Layout['activeFilter']

const FILTERS: { value: Filter; label: Key }[] = [
  { value: 'all', label: 'active.all' },
  { value: 'blocked', label: 'active.waiting' },
  { value: 'working', label: 'active.running' },
  { value: 'finished', label: 'active.finished' },
  { value: 'idle', label: 'active.idle' },
]

/** The filter that shows a team, by the lane the team is in. */
const FILTER_OF: Readonly<Record<Lane, Filter>> = {
  asking: 'blocked',
  running: 'working',
  finished: 'finished',
  standing: 'idle',
}

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

const asks = ({ session }: Placed) => session.status === 'blocked'

/** `list` cut where its teams change: each with its lead, unless that stays elsewhere for now. */
function blocks(list: Placed[], placings: ReadonlyMap<string, Placing>) {
  const cut: { team: string; lead?: Placed; members: Placed[] }[] = []
  for (const p of list) {
    const placing = placings.get(keyOf(p))
    const team = placing?.team ?? keyOf(p)
    const last = cut.at(-1)
    const block = last?.team === team ? last : { team, members: [] }
    if (block !== last) cut.push(block)
    if (placing?.depth) block.members.push(p)
    else block.lead = p
  }
  return cut
}

type Heading = { name: string; count: number; asking: number; open: boolean; onToggle?: () => void }

/** A machine's name over its agents: one that folds them away, saying how many ask while they are. */
function MachineHeading({ name, count, asking, open, onToggle }: Heading) {
  const t = useI18n()
  const inner = (
    <>
      {onToggle ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
      <span className="min-w-0 truncate">{name}</span>
      <span className="font-mono font-medium">{count}</span>
      {!open && asking ? <span className="text-warn">{t('active.asking', { n: asking })}</span> : null}
    </>
  )
  const look = 'flex h-6 min-w-0 flex-none items-center gap-1 px-1 text-[11.5px] font-semibold text-faint'
  return onToggle ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`${look} cursor-pointer rounded-md border-0 bg-transparent text-left hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent`}
    >
      {inner}
    </button>
  ) : (
    <h3 className={`${look} m-0`}>{inner}</h3>
  )
}

export function ActiveSessions() {
  const t = useI18n()
  const now = useNow()
  const { activeFilter: filter, agentFolds } = useLocal().layout
  const live = lanes(useProjects())
  const { peek, open } = usePeek()
  const books = useBooks()
  const { runs, machines } = useSpaceView()

  const lanesNow: Record<Lane, Placed[]> = {
    asking: live.asking,
    running: live.running,
    finished: [...live.finished].reverse(),
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
      return { key: keyOf(p), machine: p.session.mid, lane, ...(role ? { role } : {}) }
    }),
  )
  const placings = new Map<string, Placing>(teams(members).map(p => [p.key, p]))
  const roles = new Map(members.flatMap(m => (m.role ? [[m.key, m.role.name] as const] : [])))
  const teamLane = new Map(members.map(m => [m.key, placings.get(m.key)?.lane ?? m.lane]))
  const mids = machines.filter(m => m.online).map(m => m.state.machine.id)
  // With agents on one machine only, as most have, its name says nothing: it is left out, with its fold.
  const named = new Set(members.map(m => m.machine)).size > 1
  // On each machine, the teams by their lane, each one together.
  const ordered = mids.flatMap(mid =>
    LANES.flatMap(lane =>
      clustered(
        members.filter(m => m.machine === mid && teamLane.get(m.key) === lane).map(m => m.key),
        placings,
      ).map(key => ({ key, group: mid })),
    ),
  )
  // The one looked at stays in its place on its machine, as looking marks it seen.
  const slots = usePinned(ordered, peek ? paneKey(peek.mid, peek.paneId) : undefined)
  const placedBy = new Map(LANES.flatMap(lane => lanesNow[lane].map(p => [keyOf(p), p] as const)))

  const all = filter === 'all'
  const filterOf = (key: string) => FILTER_OF[teamLane.get(key) ?? 'standing']
  const countOf = (value: Filter) =>
    value === 'all' ? members.length : members.filter(m => filterOf(m.key) === value).length
  // Folds hold for all of them: a filter shows each it picks.
  const folded = (key: string) => all && agentFolds.includes(key)

  const propsOf = (placed: Placed) => {
    const { mid, paneId } = placed.session
    return {
      placed,
      now,
      peeking: peek?.mid === mid && peek.paneId === paneId,
      onOpen: (terminal?: boolean) => open(placed, terminal),
    }
  }
  const row = (p: Placed, team?: Team) => (
    <AgentRow key={keyOf(p)} role={roles.get(keyOf(p))} team={team} {...propsOf(p)} />
  )
  // Each team as one block: its lead, then the others on a line down from the lead's dot.
  const teamBlocks = (mid: string, list: Placed[]) =>
    blocks(list, placings).map(({ team, lead, members }) => {
      const name = lead && roles.get(keyOf(lead))
      const foldKey = name ? `team:${mid}:${name.toLowerCase()}` : undefined
      const shut = foldKey ? folded(foldKey) : false
      const toggle =
        all && foldKey && members.length
          ? {
              count: members.length,
              open: !shut,
              asking: shut && members.some(asks),
              onToggle: () => toggleAgentFold(foldKey),
            }
          : undefined
      return (
        <div key={team} className="flex flex-none flex-col">
          {lead ? row(lead, toggle) : null}
          {members.length && !shut ? (
            <div className="ml-[11px] flex flex-col border-l border-line-strong pl-[5px]">
              {members.map(p => row(p))}
            </div>
          ) : null}
        </div>
      )
    })

  const groups = mids.flatMap(mid => {
    const list = keysIn(slots, mid)
      .filter(key => all || filterOf(key) === filter)
      .flatMap(key => placedBy.get(key) ?? [])
    if (!list.length) return []
    const foldKey = `machine:${mid}`
    const shut = named && folded(foldKey)
    const name = machines.find(m => m.state.machine.id === mid)?.state.machine.name ?? mid
    return [
      <section key={mid} className="flex flex-none flex-col gap-1.5">
        {named ? (
          <MachineHeading
            name={name}
            count={list.length}
            asking={list.filter(asks).length}
            open={!shut}
            {...(all ? { onToggle: () => toggleAgentFold(foldKey) } : {})}
          />
        ) : null}
        {shut ? null : teamBlocks(mid, list)}
      </section>,
    ]
  })
  const seeAll = () => {
    markAllSeen(live.finished.map(p => ({ key: keyOf(p), since: p.session.statusSince })))
  }

  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-0.5 px-2 pt-2 pb-1.5">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setActiveFilter(value)}
            className={`h-6 cursor-pointer rounded-md border-0 px-2 text-xs whitespace-nowrap transition-colors duration-75 hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${filter === value ? 'bg-selected font-medium text-text' : 'bg-transparent text-muted hover:bg-hover'}`}
          >
            {t(label)}
            <span className="ml-1 font-normal text-faint">{countOf(value)}</span>
          </button>
        ))}
        {live.finished.length ? (
          <button
            type="button"
            onClick={seeAll}
            className="ml-auto h-6 flex-none cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-xs text-faint hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t('active.markAllSeen')}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-2 pt-0.5 pb-3.5">
        {groups.length ? (
          groups
        ) : (
          <p className="m-0 px-2 py-2.5 text-[13px] text-muted">{t('active.none')}</p>
        )}
      </div>
    </>
  )
}
