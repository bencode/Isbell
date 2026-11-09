// A session's chat in its tab: the conversation and the dock under it. Its place is kept while the
// tab is hidden.

import { ArrowDown } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import type { Ran } from '../../core/session-records'
import type { Project, Session } from '../../model/projects'
import { useKeptScroll } from '../../utils/kept-scroll'
import { SessionBody, SessionDock, useSession } from './session-parts'
import { useChatFollow } from './use-chat-follow'

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
  const { mid, paneId } = session
  const state = useSession(mid, paneId, session, project, ran)
  // After the kept place, so that it is put back before a chat left at its end goes to the end.
  const kept = useKeptScroll<HTMLDivElement>()
  const follow = useChatFollow(kept.ref, state.log, session.status === 'blocked')

  const parts = { mid, paneId, project, session, state }
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={kept.ref}
          onScroll={e => {
            kept.onScroll(e)
            follow.onScrolled()
          }}
          className="h-full overflow-auto"
        >
          <div className={`${COLUMN} flex flex-col pt-[18px] pb-7`}>
            <SessionBody {...parts} pending={follow.pending} />
          </div>
        </div>
        {follow.unseen ? <ToEndButton onClick={follow.toEnd} className="bottom-2.5" /> : null}
      </div>
      <div className="flex-none border-t border-line bg-bg">
        <div className={`${COLUMN} py-2.5`}>
          <SessionDock {...parts} onDraft={onDraft} onSent={follow.onSent} />
        </div>
      </div>
    </div>
  )
}

/** That more has come in below; `className` says how far up it floats. */
export function ToEndButton({ onClick, className }: { onClick: () => void; className: string }) {
  const t = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-raised py-1 pr-3 pl-2.5 text-xs text-muted shadow-[0_4px_14px_rgb(0_0_0/0.08)] hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      <ArrowDown size={13} />
      <b className="font-semibold text-accent">{t('chat.newContent')}</b>
      {t('chat.toEnd')}
    </button>
  )
}
