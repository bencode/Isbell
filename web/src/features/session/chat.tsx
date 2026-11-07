// A session's chat in its tab: the turns, following what comes in while scrolled to the end, and
// the dock under them. Its place is kept while the tab is hidden.

import { useLayoutEffect, useRef } from 'react'
import type { Project, Session } from '../../model/projects'
import { useKeptScroll } from '../../utils/kept-scroll'
import { SessionBody, SessionDock, useSession } from './session-parts'

// The reading column: as wide as the tab up to a comfortable measure, then centred.
const COLUMN = 'mx-auto w-full max-w-[960px] px-6'

/** `onDraft`: a reply is being written, which keeps the tab. */
export function Chat({
  project,
  session,
  onDraft,
}: {
  project: Project
  session: Session
  onDraft: () => void
}) {
  const { mid, paneId } = session
  const state = useSession(mid, paneId, session)
  const { reading, text } = state
  const kept = useKeptScroll<HTMLDivElement>()
  const pinned = useRef(true)
  // After the kept place is put back, so a chat left at its end shows what came in meanwhile.
  useLayoutEffect(() => {
    const el = kept.ref.current
    if ((reading || text !== null) && el && pinned.current) el.scrollTop = el.scrollHeight
  }, [kept.ref, reading, text])

  const parts = { mid, paneId, project, session, state }
  return (
    <div className="flex h-full flex-col">
      <div
        ref={kept.ref}
        onScroll={e => {
          kept.onScroll(e)
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        <div className={`${COLUMN} flex flex-col gap-3.5 pt-5 pb-7`}>
          <SessionBody {...parts} />
        </div>
      </div>
      <div className="flex-none border-t border-line bg-bg">
        <div className={`${COLUMN} pt-3 pb-3.5`}>
          <SessionDock {...parts} onDraft={onDraft} />
        </div>
      </div>
    </div>
  )
}
