// A pane's terminal on a phone: laid over a page that does not move, as tall as what the keyboard
// leaves of the screen, so that it loses rows as any terminal would and the cursor and the keys stay
// in sight. A menu is answered from the keys under it; the keyboard comes up at a tap, as in any
// terminal, and its key puts it away. Back from the background, it attaches again by itself.

import '@xterm/xterm/css/xterm.css'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import { useTerminal } from '../../features/session/use-terminal'
import type { Via } from '../../model/space'
import { KeyBar } from './key-bar'

type Area = { top: number; height: number }

const read = (vv: VisualViewport): Area => ({ top: vv.offsetTop, height: vv.height })

/** What of the page shows: iOS lays the keyboard over it instead of resizing it. */
function useVisibleArea(): Area | undefined {
  const [area, setArea] = useState(() => (window.visualViewport ? read(window.visualViewport) : undefined))
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setArea(read(vv))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return area
}

/** While mounted the page neither scrolls nor bounces. Let go of in a layout effect, for the chat
 * that shows after it to find a page it can put its place back in. */
function useLockedPage() {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.scroll = 'locked'
    return () => {
      delete root.dataset.scroll
    }
  }, [])
}

const onVisibility = (changed: () => void) => {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}
const pageVisible = () => document.visibilityState === 'visible'

/** Attaches a terminal whose connection was lost (`lost`: it ended with an error; one opened elsewhere
 * since ends without, and stays ended, for two screens not to take it from each other for ever), once
 * for each time it was connected, so that a pane it cannot attach to is not tried for ever. Returns
 * whether it is only waiting for the moment. In a layout effect, for "disconnected" not to flash
 * before a try that is about to start. */
function useReattach(phase: 'opening' | 'open' | 'ended', lost: boolean, reattach: () => void) {
  const { status } = useSpaceView()
  const visible = useSyncExternalStore(onVisibility, pageVisible)
  const ready = status === 'open' && visible
  const spare = useRef(true)
  useLayoutEffect(() => {
    if (phase === 'open' || !ready) spare.current = true
    else if (phase === 'ended' && lost && spare.current) {
      spare.current = false
      reattach()
    }
  }, [phase, lost, ready, reattach])
  return !ready
}

export function PhoneTerminal({
  bar,
  mid,
  paneId,
  onVia,
}: {
  bar: ReactNode
  mid: string
  paneId: string
  onVia: (via: Via | undefined) => void
}) {
  const t = useI18n()
  useLockedPage()
  const area = useVisibleArea()
  // The home indicator is under the page only while the keyboard is down.
  const keyboard = !!area && area.top + area.height < window.innerHeight - 1
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect, press, toggleKeyboard } = useTerminal(box, mid, paneId, false)
  const waiting = useReattach(state.phase, state.error !== undefined, reconnect)
  useEffect(() => onVia(state.via), [onVia, state.via])
  const ended = state.phase === 'ended' && !waiting

  return (
    <div
      className="fixed inset-x-0 flex flex-col bg-term pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
    >
      {bar}
      <div className="relative min-h-0 flex-1 overflow-hidden px-2 py-1.5">
        <div ref={box} className="h-full w-full bg-term" />
        {state.phase !== 'open' && !ended ? (
          <p className="absolute inset-0 m-0 grid place-items-center font-mono text-xs text-faint">
            {t('terminal.opening')}
          </p>
        ) : null}
        {ended ? (
          <div className="absolute inset-0 grid place-items-center bg-scrim p-4">
            <div className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-line bg-raised p-5 index-card-lifted">
              <p className="m-0 font-semibold">{t('terminal.ended')}</p>
              {state.error ? <p className="m-0 text-[13px] text-muted">{errorText(t, state.error)}</p> : null}
              <Button variant="primary" onClick={reconnect}>
                {t('terminal.reconnect')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className={`flex-none bg-[#161c27] ${keyboard ? '' : 'pb-[env(safe-area-inset-bottom)]'}`}>
        <KeyBar live={state.phase === 'open'} keyboard={keyboard} onKeyboard={toggleKeyboard} onKey={press} />
      </div>
    </div>
  )
}
