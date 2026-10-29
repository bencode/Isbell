// The board's four lanes: who asks, who finished unseen, who works, and who stands by. Every agent
// is in exactly one, and moves from lane to lane as its status changes.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { toggleStale, useLocal } from '../../core/prefs'
import type { Lanes as LaneSet, Placed } from '../../model/projects'
import { paneKey, splitStale } from '../../model/projects'
import { AgentRow } from './cards/agent-row'
import { AskingCard } from './cards/asking-card'
import { FinishedCard } from './cards/finished-card'
import { RunningCard } from './cards/running-card'
import { StandingRow } from './cards/standing-row'

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

type Props = {
  lanes: LaneSet
  now: number
  /** One under another as the page scrolls, rather than side by side, each scrolling on its own. */
  stacked?: boolean
  /** All of one project's, so the cards need not say which. */
  scoped?: boolean
  /** A phone's board: stacked, the empty lanes left out, and the agents not waiting on you in rows
   * that open their sessions. */
  phone?: boolean
}

export function Lanes({ lanes, now, stacked, scoped = false, phone = false }: Props) {
  const t = useI18n()
  return (
    <div
      className={
        phone
          ? 'flex flex-col gap-5'
          : stacked
            ? 'flex flex-col gap-4'
            : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)] gap-3'
      }
    >
      <Lane
        title={t('lane.asking')}
        dot="bg-warn"
        hint={t('lane.oldest')}
        count={lanes.asking.length}
        phone={phone}
      >
        {lanes.asking.map(p => (
          <AskingCard key={keyOf(p)} placed={p} now={now} scoped={scoped} />
        ))}
      </Lane>
      <Lane
        title={t('lane.finished')}
        dot="bg-ok"
        hint={t('lane.markRead')}
        count={lanes.finished.length}
        phone={phone}
      >
        {lanes.finished.map(p => (
          <FinishedCard key={keyOf(p)} placed={p} now={now} scoped={scoped} />
        ))}
      </Lane>
      <Lane
        title={t('lane.running')}
        dot="bg-accent"
        hint={t('lane.watch')}
        count={lanes.running.length}
        phone={phone}
      >
        {lanes.running.map(p =>
          phone ? (
            <AgentRow key={keyOf(p)} placed={p} now={now} scoped={scoped} running />
          ) : (
            <RunningCard key={keyOf(p)} placed={p} now={now} scoped={scoped} />
          ),
        )}
      </Lane>
      <Standing standing={lanes.standing} offline={lanes.offline} now={now} scoped={scoped} phone={phone} />
    </div>
  )
}

/** The rest, latest first, each opened to give it its next step; those still for a day folded at
 * the foot, each with a way to end it; then the offline ones by machine. */
function Standing({
  standing,
  offline,
  now,
  scoped,
  phone,
}: {
  standing: Placed[]
  offline: Placed[]
  now: number
  scoped: boolean
  phone: boolean
}) {
  const t = useI18n()
  // One row open at a time.
  const [open, setOpen] = useState<string | null>(null)
  const showStale = useLocal().layout.stale
  const { recent, stale } = splitStale(standing, now)
  // By machine id: two machines may share a name.
  const machines = [...new Set(offline.map(p => p.project.mid))]
  const row = (p: Placed, endable = false) =>
    phone ? (
      <AgentRow key={keyOf(p)} placed={p} now={now} scoped={scoped} />
    ) : (
      <StandingRow
        key={keyOf(p)}
        placed={p}
        now={now}
        scoped={scoped}
        open={open === keyOf(p)}
        onOpen={() => setOpen(keyOf(p))}
        onClose={() => setOpen(null)}
        endable={endable}
      />
    )
  const Chevron = showStale ? ChevronDown : ChevronRight
  return (
    <Lane
      title={t('lane.standing')}
      dot="bg-faint"
      hint={t('lane.latest')}
      count={standing.length + offline.length}
      phone={phone}
    >
      {recent.map(p => row(p))}
      {stale.length ? (
        <>
          <button
            type="button"
            onClick={toggleStale}
            aria-expanded={showStale}
            className="flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 text-left text-[11px] font-semibold tracking-[0.04em] text-faint uppercase hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Chevron size={13} className="flex-none" />
            {t('lane.stale', { n: stale.length })}
          </button>
          {showStale ? stale.map(p => row(p, true)) : null}
        </>
      ) : null}
      {machines.map(mid => {
        const rows = offline.filter(p => p.project.mid === mid)
        return (
          <div key={mid} className="flex flex-col gap-1.5">
            <h3 className="m-0 px-0.5 pt-1.5 text-xs font-semibold text-faint">
              {t('lane.offline', { machine: rows[0]?.project.machine ?? mid })}
            </h3>
            {rows.map(p => row(p))}
          </div>
        )
      })}
    </Lane>
  )
}

function Lane({
  title,
  dot,
  hint,
  count,
  phone,
  children,
}: {
  title: string
  dot: string
  hint: string
  count: number
  phone: boolean
  children: ReactNode
}) {
  const t = useI18n()
  if (phone)
    return count ? (
      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 px-0.5 text-sm font-semibold">
          <span className={`size-2 rounded-full ${dot}`} />
          {title}
          <span className="font-normal text-faint">{count}</span>
          <span className="ml-auto text-xs font-normal text-faint">{hint}</span>
        </h2>
        {children}
      </section>
    ) : null
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-side/70">
      <h2 className="m-0 flex flex-none items-center gap-2 border-b border-line px-3.5 py-2.5 text-sm font-semibold">
        <span className={`size-2 rounded-full ${dot}`} />
        {title}
        <span className="font-normal text-faint">{count}</span>
        <span className="ml-auto text-xs font-normal text-faint">{hint}</span>
      </h2>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-auto p-2.5">
        {count ? children : <p className="m-0 py-4 text-center text-[13px] text-faint">{t('lane.empty')}</p>}
      </div>
    </section>
  )
}
