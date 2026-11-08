// The right column: every session on the machines online, those that need you first, whichever
// project they are in. Opening one looks at it over the workspace, unless it is the tab on screen.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router'
import { type Key, useI18n } from '../../core/i18n'
import { type Layout, setActiveFilter, toggleIdle, useLocal } from '../../core/prefs'
import { useProjects } from '../../core/space'
import { lanes, type Placed } from '../../model/projects'
import { sessionTabId, tabOf } from '../../model/tabs'
import { useNow } from '../../utils/time'
import { ActiveCard, StandingRow } from './active-card'
import { usePeek } from './peek'
import { isTab, sessionTabHref } from './tab-kinds'

type Filter = Layout['activeFilter']

const FILTERS: { value: Filter; label: Key }[] = [
  { value: 'all', label: 'active.all' },
  { value: 'blocked', label: 'active.waiting' },
  { value: 'working', label: 'active.running' },
  { value: 'idle', label: 'active.idle' },
]

export function ActiveSessions() {
  const t = useI18n()
  const now = useNow()
  const navigate = useNavigate()
  const { activeFilter: filter, idleOpen } = useLocal().layout
  const { asking, finished, running, standing } = lanes(useProjects())
  const { peek, search, go } = usePeek()

  const counts: Record<Filter, number> = {
    all: asking.length + finished.length + running.length + standing.length,
    blocked: asking.length,
    working: running.length,
    idle: standing.length,
  }
  const cards =
    filter === 'all'
      ? [...asking, ...finished, ...running]
      : filter === 'blocked'
        ? asking
        : filter === 'working'
          ? running
          : []
  const rows = filter === 'idle' || (filter === 'all' && idleOpen) ? standing : []
  const folds = filter === 'all' && standing.length > 0

  const open = ({ session: { mid, paneId }, project }: Placed, terminal: boolean) => {
    if (tabOf(search, isTab) !== sessionTabId(mid, paneId)) go({ mid, paneId, terminal })
    else if (terminal) navigate(sessionTabHref(project.key, mid, paneId, true), { replace: true })
    else if (peek) go(null)
  }
  const propsOf = (placed: Placed) => {
    const { mid, paneId } = placed.session
    return {
      placed,
      now,
      peeking: peek?.mid === mid && peek.paneId === paneId,
      onOpen: (terminal: boolean) => open(placed, terminal),
    }
  }

  return (
    <>
      <div className="flex flex-none gap-0.5 px-2 pt-2 pb-1.5">
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
        {cards.map(p => (
          <ActiveCard key={`${p.session.mid}/${p.session.paneId}`} {...propsOf(p)} />
        ))}
        {folds ? (
          <button
            type="button"
            aria-expanded={idleOpen}
            onClick={toggleIdle}
            className="mt-1 flex h-[26px] w-full flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 text-left text-[12.5px] text-muted hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {idleOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t('active.idleCount', { n: standing.length })}
          </button>
        ) : null}
        {rows.map(p => (
          <StandingRow key={`${p.session.mid}/${p.session.paneId}`} {...propsOf(p)} />
        ))}
        {cards.length || rows.length || folds ? null : (
          <p className="m-0 px-2 py-2.5 text-[13px] text-muted">{t('active.none')}</p>
        )}
      </div>
    </>
  )
}
