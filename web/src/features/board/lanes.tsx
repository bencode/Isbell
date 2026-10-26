// The board's three lanes: who asks, who finished unseen, who works. An agent moves from lane to
// lane as its status changes; within a lane the longest waiting comes first.

import type { ReactNode } from 'react'
import { useI18n } from '../../core/i18n'
import type { Lanes as LaneSet, Placed } from '../../model/projects'
import { paneKey } from '../../model/projects'
import { AskingCard } from './cards/asking-card'
import { FinishedCard } from './cards/finished-card'
import { RunningCard } from './cards/running-card'

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

/** Side by side, each lane scrolling on its own; `stacked`, one under another as the page scrolls. */
export function Lanes({ lanes, now, stacked }: { lanes: LaneSet; now: number; stacked?: boolean }) {
  const t = useI18n()
  return (
    <div
      className={
        stacked ? 'flex flex-col gap-4' : 'grid min-h-0 flex-1 grid-cols-[1.15fr_1.05fr_0.9fr] gap-3.5'
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
    </div>
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
