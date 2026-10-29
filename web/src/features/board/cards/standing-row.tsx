// An agent standing by: finished and seen, idle, or of unknown status; or on a machine that is
// offline. A row of two lines, opened to give it its next step, or, long still, ended.

import { Power } from 'lucide-react'
import { useState } from 'react'
import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import { since } from '../../../utils/time'
import { Composer } from '../../pane/composer'
import { EndPane } from '../../pane/end-pane-dialog'
import { useReading } from '../../pane/use-reading'
import { lastWords, OpenButton, SentNote, useSent } from './card'

const GO =
  'h-[26px] flex-none cursor-pointer rounded-md border border-line-strong bg-raised px-2.5 text-xs text-accent hover:bg-raised-2'

export function StandingRow({
  placed,
  now,
  scoped,
  open,
  onOpen,
  onClose,
  endable,
}: {
  placed: Placed
  now: number
  /** All of one project's, so the row need not say which. */
  scoped: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Long still, so it offers to end it. */
  endable: boolean
}) {
  const t = useI18n()
  const { session, project } = placed
  const { sent, markSent, unsend } = useSent(session)
  const [ending, setEnding] = useState(false)
  const unknown = session.status === 'unknown'
  const frame = !project.online
    ? 'border-line opacity-60'
    : open
      ? 'border-accent ring-2 ring-accent-soft'
      : 'border-line'
  return (
    <div className={`flex flex-col gap-0.5 rounded-lg border bg-raised px-2.5 py-1.5 text-[13px] ${frame}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <b className="truncate font-semibold">{session.name}</b>
        <span
          title={unknown ? t('status.unknown') : undefined}
          className="flex-none rounded-[3px] border border-line px-1 text-[10px] font-semibold tracking-[0.05em] text-muted uppercase"
        >
          {unknown ? '?' : t(`status.${session.status}`)}
        </span>
        <span className="ml-auto flex-none text-[11.5px] text-faint">{since(session.statusSince, now)}</span>
        {endable ? (
          <button
            type="button"
            onClick={() => setEnding(true)}
            aria-label={t('session.end')}
            title={t('session.end')}
            className="inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-faint hover:bg-raised-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Power size={13} />
          </button>
        ) : null}
        <OpenButton session={session} />
      </div>
      <div className="flex min-h-[26px] min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
          {scoped ? null : project.name}
        </span>
        {!project.online ? null : sent ? (
          <SentNote what={sent} onAgain={unsend} />
        ) : (
          <button type="button" onClick={open ? onClose : onOpen} className={GO}>
            {open ? t('close') : t('card.continue')}
          </button>
        )}
      </div>
      {open && !sent ? (
        <Continue
          placed={placed}
          onSent={what => {
            markSent(what)
            onClose()
          }}
        />
      ) : null}
      {endable ? (
        <EndPane
          open={ending}
          onOpenChange={setEnding}
          mid={session.mid}
          paneId={session.paneId}
          name={session.name}
          machine={project.machine}
          path={project.display}
          agent
          // The row leaves the lane once the machine says the pane is gone.
          onEnded={() => setEnding(false)}
        />
      ) : null}
    </div>
  )
}

/** The agent's last words, and a reply box to give it its next step. */
function Continue({ placed: { session }, onSent }: { placed: Placed; onSent: (what: string) => void }) {
  const t = useI18n()
  const { mid, paneId } = session
  // A settled agent is read once.
  const { reading, error } = useReading(mid, paneId, session)
  const last = lastWords(reading)
  return (
    <div className="flex flex-col gap-2 pt-1.5 pb-1">
      {last ? <p className="m-0 line-clamp-2 text-[12.5px] text-muted">{last}</p> : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{errorText(t, error)}</p> : null}
      <Composer mid={mid} paneId={paneId} onSent={onSent} compact />
    </div>
  )
}
