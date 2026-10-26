// Needs you: the agents that ask, and the ones that finished and were not seen yet. A row opens in
// place to answer it; one row is open at a time.

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { StatusChip } from '../../components/chip'
import { useI18n } from '../../core/i18n'
import { markSeen } from '../../core/prefs'
import { type Project, paneKey, type Session } from '../../model/projects'
import { since, useNow } from '../../utils/time'
import { NeedBody } from './need-body'
import { FIRST, follow, type Open } from './open'

type Row = { session: Session; project?: Project | undefined }

const keyOf = (s: Session) => paneKey(s.mid, s.paneId)
const label = ({ session, project }: Row) => (project ? `${session.name} · ${project.name}` : session.name)

export function NeedsSection({ rows }: { rows: Row[] }) {
  const t = useI18n()
  const now = useNow()
  // Null once a row was closed by hand; then nothing opens by itself until one is picked.
  const [open, setOpen] = useState<Open | null>(FIRST)
  const shown = follow(
    rows.map(r => keyOf(r.session)),
    open,
  )
  // Kept as the open row, so one arriving above it does not take its place. An empty list keeps
  // what was open, so the first row to come opens.
  if (shown && (shown.key !== open?.key || shown.at !== open?.at)) setOpen(shown)
  if (!rows.length) return null

  /** Leaving a finished session, as on its page, marks it read. */
  const leave = () => {
    const was = shown && rows[shown.at]?.session
    if (was?.status === 'done') markSeen(keyOf(was), was.statusSince)
  }
  const toggle = (key: string, at: number) => {
    leave()
    setOpen(shown?.key === key ? null : { key, at })
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
        {t('needs.title')} <span className="text-sm font-normal text-faint">{rows.length}</span>
      </h2>
      <div className="overflow-hidden rounded-[10px] border border-line bg-raised">
        {rows.map((row, at) => {
          const key = keyOf(row.session)
          const next = rows[at + 1] ?? rows[at - 1]
          return (
            <div key={key} className="border-line [&+&]:border-t">
              <NeedRow row={row} now={now} open={shown?.key === key} onToggle={() => toggle(key, at)} />
              {shown?.key === key ? <NeedBody session={row.session} next={next && label(next)} /> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function NeedRow({
  row: { session, project },
  now,
  open,
  onToggle,
}: {
  row: Row
  now: number
  open: boolean
  onToggle: () => void
}) {
  const t = useI18n()
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`flex w-full cursor-pointer items-center gap-3 border-0 px-4 py-2.5 text-left text-text hover:bg-raised-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${open ? 'bg-raised-2' : 'bg-transparent'}`}
    >
      <StatusChip status={session.status} label={t(`status.${session.status}`)} />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold">{session.name}</b>
        {session.title ? <span className="text-muted"> · {session.title}</span> : null}
      </span>
      {project ? (
        <span className="flex-none text-xs text-faint">
          {project.name} · {project.machine}
        </span>
      ) : null}
      <span className="w-8 flex-none text-right text-xs text-faint">{since(session.statusSince, now)}</span>
      <ChevronDown
        size={15}
        className={`flex-none text-faint transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
  )
}
