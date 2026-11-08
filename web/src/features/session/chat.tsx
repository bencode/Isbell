// A session's chat in its tab: the conversation, following what comes in while scrolled to the end
// (and saying so while scrolled up), and the dock under it. Its place is kept while the tab is hidden;
// what was sent shows at once, until the record has it.

import { ArrowDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../core/i18n'
import type { Ran } from '../../core/session-records'
import type { ChatTurn } from '../../model/chat/types'
import { splitUploads } from '../../model/files/uploads'
import type { Project, Session } from '../../model/projects'
import { useKeptScroll } from '../../utils/kept-scroll'
import { SessionBody, SessionDock, useSession } from './session-parts'

/** What was sent and when, and the record's last turn then (null: none yet; undefined: not read
 * yet). */
type Sent = { text: string; at: number; after: string | null | undefined }

/** What was sent that the record does not have yet, in order. Each takes a turn asking after the one
 * last when it was sent, the one asking the same first; without a turn to tell by, only that one. */
function unrecorded(sent: Sent[], turns: ChatTurn[] | undefined): Sent[] {
  const used = new Set<string>()
  return sent.filter(({ text, after }) => {
    const from = after ? (turns ?? []).findIndex(turn => turn.id === after) + 1 : 0
    const asked = (turns ?? []).slice(from).filter(turn => turn.you && !used.has(turn.id))
    const said = splitUploads(text).text
    const it =
      asked.find(turn => turn.you?.text.trim() === said) ?? (after === undefined ? undefined : asked[0])
    if (it) used.add(it.id)
    return !it
  })
}

// The reading column: as wide as the tab up to a comfortable measure, then centred.
const COLUMN = 'mx-auto w-full max-w-[760px] px-[22px]'

/** `ran`: the session the agent runs, once known. `onDraft`: a reply is being written, which keeps
 * the tab. */
export function Chat({
  project,
  session,
  ran,
  onDraft,
}: {
  project: Project
  session: Session
  ran: Ran | undefined
  onDraft: () => void
}) {
  const t = useI18n()
  const { mid, paneId } = session
  const state = useSession(mid, paneId, session, project, ran)
  const { log } = state
  const asking = session.status === 'blocked'
  const [sent, setSent] = useState<Sent[]>([])
  const pending = unrecorded(sent, log.turns)
  const waits = pending.length
  const kept = useKeptScroll<HTMLDivElement>()
  const pinned = useRef(true)
  const [unseen, setUnseen] = useState(false)
  // After the kept place is put back, so a chat left at its end shows what came in meanwhile: the
  // record read further (earlier turns read before it are no news), what was sent, the agent asking.
  useLayoutEffect(() => {
    const el = kept.ref.current
    if (!el || (!log.end && !waits && !asking)) return
    if (pinned.current) el.scrollTop = el.scrollHeight
    else setUnseen(true)
  }, [kept.ref, log.end, waits, asking])
  const toEnd = () => {
    const el = kept.ref.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const parts = { mid, paneId, project, session, state }
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={kept.ref}
          onScroll={e => {
            kept.onScroll(e)
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            if (pinned.current) setUnseen(false)
          }}
          className="h-full overflow-auto"
        >
          <div className={`${COLUMN} flex flex-col pt-[18px] pb-7`}>
            <SessionBody {...parts} pending={pending} />
          </div>
        </div>
        {unseen ? (
          <button
            type="button"
            onClick={toEnd}
            className="absolute bottom-2.5 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-raised py-1 pr-3 pl-2.5 text-xs text-muted shadow-[0_4px_14px_rgb(0_0_0/0.08)] hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ArrowDown size={13} />
            <b className="font-semibold text-accent">{t('chat.newContent')}</b>
            {t('chat.toEnd')}
          </button>
        ) : null}
      </div>
      <div className="flex-none border-t border-line bg-bg">
        <div className={`${COLUMN} py-2.5`}>
          <SessionDock
            {...parts}
            onDraft={onDraft}
            onSent={text => {
              // Sent ends at the bottom, to see it go in.
              pinned.current = true
              const after = log.turns ? (log.turns.at(-1)?.id ?? null) : undefined
              setSent([...pending, { text, at: Date.now(), after }])
            }}
          />
        </div>
      </div>
    </div>
  )
}
