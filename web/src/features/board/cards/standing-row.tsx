// An agent standing by: finished and seen, idle, or of unknown status; or on a machine that is
// offline. A row of two lines, opened to give it its next step.

import { errorText, useI18n } from '../../../core/i18n'
import type { Placed } from '../../../model/projects'
import type { Block } from '../../../model/screen/types'
import { since } from '../../../utils/time'
import { Composer } from '../../pane/composer'
import { useReading } from '../../pane/use-reading'
import { lastReply, OpenButton, SentNote, useSent } from './card'

const GO =
  'h-[26px] flex-none cursor-pointer rounded-md border border-line-strong bg-raised px-2.5 text-xs text-accent hover:bg-raised-2'

export function StandingRow({
  placed,
  now,
  scoped,
  open,
  onOpen,
  onClose,
}: {
  placed: Placed
  now: number
  /** All of one project's, so the row need not say which. */
  scoped: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const t = useI18n()
  const { session, project } = placed
  const { sent, markSent, unsend } = useSent(session)
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
    </div>
  )
}

/** The agent's last words, and a reply box to give it its next step. */
function Continue({ placed: { session }, onSent }: { placed: Placed; onSent: (what: string) => void }) {
  const t = useI18n()
  const { mid, paneId } = session
  // A settled agent is read once.
  const { reading, error } = useReading(mid, paneId, session)
  const last = lastReply(reading)
    ?.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .at(-1)
  return (
    <div className="flex flex-col gap-2 pt-1.5 pb-1">
      {last ? <p className="m-0 line-clamp-2 text-[12.5px] text-muted">{last.text}</p> : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{errorText(t, error)}</p> : null}
      <Composer mid={mid} paneId={paneId} onSent={onSent} compact />
    </div>
  )
}
