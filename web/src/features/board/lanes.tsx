// The board's four lanes: who asks, who finished unseen, who works, and who stands by. Every agent
// is in exactly one, and moves from lane to lane as its status changes.

import { type ReactNode, useState } from 'react'
import { useI18n } from '../../core/i18n'
import type { Lanes as LaneSet, Placed } from '../../model/projects'
import { paneKey } from '../../model/projects'
import { AskingCard } from './cards/asking-card'
import { FinishedCard } from './cards/finished-card'
import { RunningCard } from './cards/running-card'
import { StandingRow } from './cards/standing-row'

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

/** Side by side, each lane scrolling on its own; `stacked`, one under another as the page scrolls. */
export function Lanes({ lanes, now, stacked }: { lanes: LaneSet; now: number; stacked?: boolean }) {
  const t = useI18n()
  return (
    <div
      className={
        stacked
          ? 'flex flex-col gap-4'
          : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)] gap-3'
      }
    >
      <Lane title={t('lane.asking')} dot="bg-warn" hint={t('lane.oldest')} count={lanes.asking.length}>
        {lanes.asking.map(p => (
          <AskingCard key={keyOf(p)} placed={p} now={now} />
        ))}
      </Lane>
      <Lane title={t('lane.finished')} dot="bg-ok" hint={t('lane.markRead')} count={lanes.finished.length}>
        {lanes.finished.map(p => (
          <FinishedCard key={keyOf(p)} placed={p} now={now} />
        ))}
      </Lane>
      <Lane title={t('lane.running')} dot="bg-accent" hint={t('lane.readOnly')} count={lanes.running.length}>
        {lanes.running.map(p => (
          <RunningCard key={keyOf(p)} placed={p} now={now} />
        ))}
      </Lane>
      <Standing standing={lanes.standing} offline={lanes.offline} now={now} />
    </div>
  )
}

/** The rest, latest first, each opened to give it its next step; then the offline ones by machine. */
function Standing({ standing, offline, now }: { standing: Placed[]; offline: Placed[]; now: number }) {
  const t = useI18n()
  // One row open at a time.
  const [open, setOpen] = useState<string | null>(null)
  // By machine id: two machines may share a name.
  const machines = [...new Set(offline.map(p => p.project.mid))]
  const row = (p: Placed) => (
    <StandingRow
      key={keyOf(p)}
      placed={p}
      now={now}
      open={open === keyOf(p)}
      onOpen={() => setOpen(keyOf(p))}
      onClose={() => setOpen(null)}
    />
  )
  return (
    <Lane
      title={t('lane.standing')}
      dot="bg-faint"
      hint={t('lane.latest')}
      count={standing.length + offline.length}
    >
      {standing.map(row)}
      {machines.map(mid => {
        const rows = offline.filter(p => p.project.mid === mid)
        return (
          <div key={mid} className="flex flex-col gap-1.5">
            <h3 className="m-0 px-0.5 pt-1.5 text-[11px] font-semibold tracking-[0.04em] text-faint uppercase">
              {t('lane.offline', { machine: rows[0]?.project.machine ?? mid })}
            </h3>
            {rows.map(row)}
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
  children,
}: {
  title: string
  dot: string
  hint: string
  count: number
  children: ReactNode
}) {
  const t = useI18n()
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
