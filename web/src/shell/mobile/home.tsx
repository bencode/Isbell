// A phone's first tab, Agents: every agent on the machines online by its role's name, as on a
// computer's right column. Those that ask you come first, then those working, then those just
// finished; an agent comes with the running agents reporting to it, as a team on one card, under the
// most urgent lane of any in it. Those standing by fold into a line, the ones still for a day last.
// The page itself scrolls.

import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { useRoleOf } from '../../core/books'
import { type Key, useI18n } from '../../core/i18n'
import { toggleIdle, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Placed, placedKey, splitStale } from '../../model/projects'
import { clustered, LANES, type Lane, membersOf, type Placing, teamBlocks, teams } from '../../model/roles'
import { useNow } from '../../utils/time'
import { PhoneBar, TAP } from './bar'
import { AgentCard, type Named, StandingRow } from './card'
import { MoreMenu } from './more-menu'
import { usePlaceKept } from './page-place'
import { TabBar, TabTitle, UNDER_TABS } from './tab-bar'

const TITLES: Readonly<Record<Exclude<Lane, 'standing'>, Key>> = {
  asking: 'sessions.asking',
  running: 'active.running',
  finished: 'active.finished',
}

export function Home() {
  usePlaceKept('home')
  const t = useI18n()
  const now = useNow()
  const { loaded } = useSpaceView()
  const live = lanes(useProjects())
  const roleFor = useRoleOf()
  const { idleOpen } = useLocal().layout

  const byLane: Record<Lane, Placed[]> = {
    asking: live.asking,
    running: live.running,
    finished: [...live.finished].reverse(),
    standing: live.standing,
  }
  const members = membersOf(byLane, roleFor)
  const placings = new Map<string, Placing>(teams(members).map(p => [p.key, p]))
  const placedBy = new Map(LANES.flatMap(lane => byLane[lane].map(p => [placedKey(p), p] as const)))
  const roles = new Map(members.flatMap(m => (m.role ? [[m.key, m.role.name] as const] : [])))
  const named = (p: Placed): Named => {
    const role = roles.get(placedKey(p))
    return role ? { placed: p, role } : { placed: p }
  }
  // Each lane's agents, each team together, as a team stands by the most urgent lane of any in it.
  const inLane = (lane: Lane) =>
    clustered(
      members.filter(m => (placings.get(m.key)?.lane ?? m.lane) === lane).map(m => m.key),
      placings,
    ).flatMap(key => placedBy.get(key) ?? [])

  const standing = splitStale(inLane('standing'), now)
  const standingCount = standing.recent.length + standing.stale.length
  const sections = (['asking', 'running', 'finished'] as const).flatMap(lane => {
    const list = inLane(lane)
    if (!list.length) return []
    return [
      <section key={lane} className="flex flex-col gap-2 px-3 pt-3.5">
        <h2
          className={`m-0 flex items-baseline gap-1.5 px-1 text-[12.5px] font-semibold ${lane === 'asking' ? 'text-warn' : 'text-muted'}`}
        >
          {t(TITLES[lane])}
          <span className="font-mono text-[11.5px] font-normal text-faint">{list.length}</span>
        </h2>
        {teamBlocks(list, placings).flatMap(({ team, lead, members: led }) => {
          // A team keeps to one lane, so its lead is here; were it not, each of the others stands alone.
          if (!lead) return led.map(m => <AgentCard key={placedKey(m)} agent={named(m)} now={now} />)
          return [<AgentCard key={team} agent={named(lead)} now={now} members={led.map(named)} />]
        })}
      </section>,
    ]
  })

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <TabTitle>{t('workbench.agents')}</TabTitle>
        <Link to="/new" aria-label={t('session.new')} className={TAP}>
          <span className="grid size-[30px] place-items-center rounded-full bg-accent text-accent-ink">
            <Plus size={18} strokeWidth={2.4} />
          </span>
        </Link>
        <MoreMenu />
      </PhoneBar>
      <main className={`flex-1 ${UNDER_TABS}`}>
        {sections}
        {standingCount ? (
          <section className="px-3 pt-3">
            <button
              type="button"
              aria-expanded={idleOpen}
              onClick={toggleIdle}
              className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-raised-2 px-3 text-left text-[13.5px] text-muted active:bg-press"
            >
              <span className="flex-1">
                {[
                  standing.recent.length ? t('active.idleCount', { n: standing.recent.length }) : '',
                  standing.stale.length ? t('mobile.stale', { n: standing.stale.length }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {idleOpen ? (
                <ChevronDown size={16} className="text-faint" />
              ) : (
                <ChevronRight size={16} className="text-faint" />
              )}
            </button>
            {idleOpen
              ? [...standing.recent, ...standing.stale].map(p => (
                  <StandingRow key={placedKey(p)} agent={named(p)} now={now} />
                ))
              : null}
          </section>
        ) : null}
        {loaded && !sections.length && !standingCount ? (
          <p className="m-0 px-4 py-4 text-muted">{t('active.none')}</p>
        ) : null}
      </main>
      <TabBar />
    </div>
  )
}
