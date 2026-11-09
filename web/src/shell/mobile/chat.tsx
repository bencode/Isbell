// A session's chat on a phone, scrolling with the page, with the reply stuck to the bottom of the
// screen; while the agent asks, what it waits on and the way to its terminal are there instead.

import { SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useI18n } from '../../core/i18n'
import type { Ran } from '../../core/session-records'
import { ToEndButton } from '../../features/session/chat'
import { useShowTerminal } from '../../features/session/context'
import { SessionBody, useSession } from '../../features/session/session-parts'
import { useAgentNote } from '../../features/session/use-agent-note'
import { useChatFollow } from '../../features/session/use-chat-follow'
import { toolLine } from '../../model/agent-note'
import type { Project, Session } from '../../model/projects'
import { PhoneComposer } from './composer'

const PAGE = { current: document.documentElement }

export function PhoneChat({
  project,
  session,
  ran,
}: {
  project: Project
  session: Session
  ran: Ran | undefined
}) {
  const { mid, paneId } = session
  const state = useSession(mid, paneId, session, project, ran)
  const { log } = state
  const asking = session.status === 'blocked'
  // Put back as the chat shows again from behind the terminal, before it goes to the end if left there.
  const place = useRef(0)
  useLayoutEffect(() => {
    PAGE.current.scrollTop = place.current
  }, [])
  const follow = useChatFollow(PAGE, log, asking)
  const { onScrolled } = follow
  useEffect(() => {
    const scrolled = () => {
      place.current = PAGE.current.scrollTop
      onScrolled()
    }
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => window.removeEventListener('scroll', scrolled)
  }, [onScrolled])

  // Safari does not hold the page still when turns come in above what is read, so the distance from
  // the end is held here.
  const fromEnd = useRef<number>(undefined)
  const earlier = () => {
    fromEnd.current = PAGE.current.scrollHeight - PAGE.current.scrollTop
    log.earlier()
  }
  useLayoutEffect(() => {
    if (fromEnd.current === undefined || log.paging) return
    PAGE.current.scrollTop = PAGE.current.scrollHeight - fromEnd.current
    fromEnd.current = undefined
  }, [log.paging])

  return (
    <>
      <main className="min-w-0 flex-1 px-4 pt-4 text-[15px] leading-[1.55]">
        <SessionBody
          mid={mid}
          paneId={paneId}
          project={project}
          session={session}
          state={{ ...state, log: { ...log, earlier } }}
          pending={follow.pending}
          asksInDock
        />
      </main>
      <div
        className={`sticky bottom-0 z-10 border-t pb-[calc(env(safe-area-inset-bottom)+8px)] ${asking ? 'border-ask-line bg-ask px-3.5 pt-3' : 'border-line bg-bg px-2.5 pt-2'}`}
      >
        {follow.unseen ? <ToEndButton onClick={follow.toEnd} className="bottom-full mb-2" /> : null}
        {asking ? <Asking session={session} /> : null}
        {/* Hidden, not gone, so that a reply half written is still there once the agent is answered. */}
        <div className={asking ? 'hidden' : ''}>
          <PhoneComposer
            mid={mid}
            paneId={paneId}
            machine={project.machine}
            stoppable={session.status === 'working'}
            onSent={follow.onSent}
          />
        </div>
      </div>
    </>
  )
}

function Asking({ session: { mid, paneId, name } }: { session: Session }) {
  const t = useI18n()
  const show = useShowTerminal()
  const waits = useAgentNote({ mid, paneId, status: 'blocked', statusSince: 0 })?.asking
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 flex items-center gap-[7px] text-[13.5px] font-semibold">
        <span className="size-[7px] rounded-full bg-warn" />
        {t('ask.title', { name })}
      </h2>
      {waits ? (
        <pre className="m-0 max-h-28 overflow-auto rounded-[7px] border border-line bg-raised px-2.5 py-[7px] font-mono text-[12.5px] leading-[1.45] whitespace-pre-wrap">
          {toolLine(waits)}
        </pre>
      ) : null}
      <button
        type="button"
        onClick={show}
        className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border-0 bg-accent text-[15px] font-semibold text-accent-ink active:opacity-85"
      >
        <SquareTerminal size={17} />
        {t('ask.inTerminal')}
      </button>
    </section>
  )
}
