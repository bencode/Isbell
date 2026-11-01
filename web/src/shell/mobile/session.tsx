// A session's page on a phone, scrolling with the page: its bar stays at the top, the turns follow
// what comes in while the reader is at the end, and the reply is fixed to the bottom, rising over the
// keyboard. A question ends the turns instead, in the page's flow, however tall it is. One scroller
// to the page, so iOS has no other to hand a gesture to.

import { useLayoutEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Sheet } from '../../components/sheet'
import { useI18n } from '../../core/i18n'
import { EndPane } from '../../features/pane/end-pane-dialog'
import type { FoundSession } from '../../features/pane/session-page'
import { SessionBody, SessionDock, SessionFacts, useSession } from '../../features/pane/session-parts'
import { usePageStick } from '../../utils/page-stick'
import { useKeyboard } from '../../utils/viewport'
import { ReconnectBanner } from '../common'
import { MobilePaneBar } from './pane'

// Clear of the notch's sides.
const SIDES = 'pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]'

export function PhoneSession({ mid, paneId, project, session, after }: FoundSession) {
  const t = useI18n()
  const navigate = useNavigate()
  const [ending, setEnding] = useState(false)
  const [sheet, setSheet] = useState(false)
  const state = useSession(mid, paneId, session)
  const keyboard = useKeyboard()
  const stick = usePageStick()
  const [dock, dockHeight] = useHeight()

  // Earlier turns come in above what is read; the page keeps it in place.
  const { onEarlier } = state
  const parts = {
    mid,
    paneId,
    project,
    session,
    state: {
      ...state,
      onEarlier:
        onEarlier &&
        (() => {
          stick.keepFromEnd()
          onEarlier()
        }),
    },
  }
  return (
    <>
      {/* The screen's height at least, the paper filling what the bar leaves, so a short session
          does not scroll. */}
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-text">
          <MobilePaneBar
            found={{ project, name: session.name, pane: { session } }}
            mid={mid}
            paneId={paneId}
            view="chat"
            onEnd={() => setEnding(true)}
            onFacts={() => setSheet(true)}
          />
          <ReconnectBanner />
        </header>
        {/* Its end clear of the reply and the keyboard under it, or of the home indicator. */}
        <main
          className={`paper flex flex-1 flex-col gap-3.5 pt-5 ${SIDES} ${state.asking ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]' : ''}`}
          style={state.asking ? undefined : { paddingBottom: dockHeight + keyboard.height + 16 }}
        >
          <SessionBody {...parts} />
          {state.asking ? <SessionDock {...parts} /> : null}
        </main>
      </div>
      {state.asking ? null : (
        // The home indicator is under it only while the keyboard is down.
        <div
          ref={dock}
          className={`fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg pt-3 ${SIDES} ${keyboard.height ? 'pb-3' : 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]'}`}
          style={keyboard.lift ? { transform: `translateY(${-keyboard.lift}px)` } : undefined}
        >
          <SessionDock {...parts} />
        </div>
      )}
      <Sheet open={sheet} onOpenChange={setSheet} title={session.name} closeLabel={t('close')}>
        {sheet ? <SessionFacts mid={mid} project={project} session={session} /> : null}
      </Sheet>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={session.name}
        machine={project.machine}
        path={project.display}
        agent
        onEnded={() => navigate(after)}
      />
    </>
  )
}

/** A ref, and the height with its padding of the element it is on, as it changes; 0 while it is on
 * none, as the reply's while the agent asks. */
function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const sized = new ResizeObserver(() => setHeight(el.offsetHeight))
    // The border box, so the home indicator's padding coming and going counts.
    sized.observe(el, { box: 'border-box' })
    return () => sized.disconnect()
  }, [el])
  return [setEl, el ? height : 0]
}
