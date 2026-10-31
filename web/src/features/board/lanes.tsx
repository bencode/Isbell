// The board's four lanes: who asks, who finished unseen, who works, and who stands by. Every agent
// is in exactly one, and moves from lane to lane as its status changes.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { toggleShells, toggleStale, useLocal } from '../../core/prefs'
import type { Lanes as LaneSet, Placed, PlacedShell } from '../../model/projects'
import { paneKey, splitStale } from '../../model/projects'
import { AgentRow } from './cards/agent-row'
import { AskingCard } from './cards/asking-card'
import { FinishedCard } from './cards/finished-card'
import { RunningCard } from './cards/running-card'
import { StandingRow } from './cards/standing-row'
import { TerminalRow } from './cards/terminal-row'
import { EndAll } from './end-all'

const keyOf = ({ session }: Placed) => paneKey(session.mid, session.paneId)

type Props = {
  lanes: LaneSet
  now: number
  /** One under another as the page scrolls, rather than side by side, each scrolling on its own; the
   * empty lanes left out. */
  stacked?: boolean
  /** All of one project's, so the cards need not say which. */
  scoped?: boolean
  /** A phone's board: stacked, the empty lanes left out, and the agents not waiting on you in rows
   * that open their sessions. */
  phone?: boolean
}

export function Lanes({ lanes, now, stacked = false, scoped = false, phone = false }: Props) {
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
        stacked={stacked}
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
        stacked={stacked}
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
        stacked={stacked}
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
      <Standing
        standing={lanes.standing}
        offline={lanes.offline}
        shells={lanes.shells}
        now={now}
        scoped={scoped}
        stacked={stacked}
        phone={phone}
      />
    </div>
  )
}

/** The rest, latest first, each opened to give it its next step or ended; those still for a day
 * folded at the foot, then the plain shells (not on a phone), each fold with a way to end all in it;
 * then the offline ones by machine. */
function Standing({
  standing,
  offline,
  shells,
  now,
  scoped,
  stacked,
  phone,
}: {
  standing: Placed[]
  offline: Placed[]
  shells: PlacedShell[]
  now: number
  scoped: boolean
  stacked: boolean
  phone: boolean
}) {
  const t = useI18n()
  // One row open at a time.
  const [open, setOpen] = useState<string | null>(null)
  const layout = useLocal().layout
  const { recent, stale } = splitStale(standing, now)
  // By machine id: two machines may share a name.
  const machines = [...new Set(offline.map(p => p.project.mid))]
  const row = (p: Placed) =>
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
      />
    )
  return (
    <Lane
      title={t('lane.standing')}
      dot="bg-faint"
      hint={t('lane.latest')}
      count={standing.length + offline.length}
      empty={!standing.length && !offline.length && (phone || !shells.length)}
      stacked={stacked}
      phone={phone}
    >
      {recent.map(row)}
      {stale.length ? (
        <>
          <Fold open={layout.stale} onToggle={toggleStale} label={t('lane.stale', { n: stale.length })}>
            {phone ? null : (
              <EndAll
                panes={stale.map(p => p.session)}
                title={t('end.allTitle', { n: stale.length })}
                body={t('end.allBody', { names: stale.map(p => p.session.name).join(', ') })}
              />
            )}
          </Fold>
          {layout.stale ? stale.map(row) : null}
        </>
      ) : null}
      {phone || !shells.length ? null : (
        <>
          <Fold open={layout.shells} onToggle={toggleShells} label={t('lane.shells', { n: shells.length })}>
            <EndAll
              panes={shells.map(p => p.shell)}
              title={t('end.shellsTitle', { n: shells.length })}
              body={t('end.shellsBody', {
                panes: shells.map(p => `${p.shell.paneId} (${p.project.name})`).join(', '),
              })}
            />
          </Fold>
          {layout.shells
            ? shells.map(p => (
                <TerminalRow key={paneKey(p.shell.mid, p.shell.paneId)} placed={p} scoped={scoped} />
              ))
            : null}
        </>
      )}
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

/** `count`: what the lane's title counts; `empty`, whether it holds nothing at all (none counted, by
 * default). Stacked, as on a phone, an empty lane is left out. */
function Lane({
  title,
  dot,
  hint,
  count,
  empty = count === 0,
  stacked,
  phone,
  children,
}: {
  title: string
  dot: string
  hint: string
  count: number
  empty?: boolean
  stacked: boolean
  phone: boolean
  children: ReactNode
}) {
  const t = useI18n()
  if (stacked && empty) return null
  if (phone)
    return empty ? null : (
      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 px-0.5 text-sm font-semibold">
          <span className={`size-2 rounded-full ${dot}`} />
          {title}
          <span className="font-normal text-faint">{count}</span>
          <span className="ml-auto text-xs font-normal text-faint">{hint}</span>
        </h2>
        {children}
      </section>
    )
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-line bg-side/70">
      <h2 className="m-0 flex flex-none items-center gap-2 border-b border-line px-3.5 py-2.5 text-sm font-semibold">
        <span className={`size-2 rounded-full ${dot}`} />
        {title}
        <span className="font-normal text-faint">{count}</span>
        <span className="ml-auto text-xs font-normal text-faint">{hint}</span>
      </h2>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-auto p-2.5">
        {empty ? <p className="m-0 py-4 text-center text-[13px] text-faint">{t('lane.empty')}</p> : children}
      </div>
    </section>
  )
}

/** A fold at the foot of a lane: its label, opening or closing what it holds, and what it does to
 * all of them (`children`). */
function Fold({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean
  onToggle: () => void
  label: string
  children: ReactNode
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="flex flex-none items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 flex-1 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 text-left text-[11px] font-semibold tracking-[0.04em] text-faint uppercase hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Chevron size={13} className="flex-none" />
        {label}
      </button>
      {children}
    </div>
  )
}
