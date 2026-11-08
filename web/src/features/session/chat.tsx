// A session's chat in its tab: the conversation, following what comes in while scrolled to the end
// (and saying so while scrolled up), and the dock under it. Its place is kept while the tab is hidden;
// what was sent shows at once, until the record has it.

import { ArrowDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { splitUploads } from '../../model/files/uploads'
import type { Project, Session } from '../../model/projects'
import { useKeptScroll } from '../../utils/kept-scroll'
import { SessionBody, SessionDock, useSession } from './session-parts'

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
  ran: { agent: string; id: string } | undefined
  onDraft: () => void
}) {
  const t = useI18n()
  const { mid, paneId } = session
  const state = useSession(mid, paneId, session, project, ran)
  const { log } = state
  const asking = session.status === 'blocked'
  // What was sent, and the record's last turn then (null: none yet; undefined: the record was not
  // read yet). A new turn after that one is it; without one to tell by, a turn asking the same.
  const [sent, setSent] = useState<{ text: string; after: string | null | undefined }>()
  const last = log.turns?.at(-1)
  const recorded =
    !!sent &&
    !!last?.you &&
    (sent.after === undefined
      ? last.you.text.trim() === splitUploads(sent.text).text
      : last.id !== sent.after)
  const pending = sent && !recorded ? sent.text : undefined
  const kept = useKeptScroll<HTMLDivElement>()
  const pinned = useRef(true)
  const [unseen, setUnseen] = useState(false)
  // After the kept place is put back, so a chat left at its end shows what came in meanwhile: the
  // record read further (earlier turns read before it are no news), what was sent, the agent asking.
  useLayoutEffect(() => {
    const el = kept.ref.current
    if (!el || (!log.end && pending === undefined && !asking)) return
    if (pinned.current) el.scrollTop = el.scrollHeight
    else setUnseen(true)
  }, [kept.ref, log.end, pending, asking])
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
              setSent({ text, after: log.turns ? (last?.id ?? null) : undefined })
            }}
          />
        </div>
      </div>
    </div>
  )
}
