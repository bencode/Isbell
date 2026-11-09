// A shared terminal, watched: the throwaway space its link opens, an xterm that takes no keys, and
// the stream kept up until the share is over.

import { Terminal as XTerm } from '@xterm/xterm'
import { type RefObject, useEffect, useState } from 'react'
import { RELAY_URL } from '../../core/space'
import { FONT, fontReady, MIN_CONTRAST, NIGHT } from '../../features/session/use-terminal'
import { parseKey } from '../../model/identity'
import { createSpace, type Space } from '../../model/space'
import { CallError } from '../../model/streams'
import { afterEnd, openWatch, type Watch, type WatchPhase } from '../../model/watch'

const RETRY_MS = 3_000
/** A machine away this long is taken to have ended the share. */
const GIVE_UP_MS = 60_000
/** Below this the text is hard to read, and the viewer is told how to see it larger. */
const SMALL_BELOW = 0.7

type Show = { phase: (phase: WatchPhase) => void; small: (small: boolean) => void }

function openSpace(shareKey: string): Space | undefined {
  try {
    return createSpace(RELAY_URL, parseKey(shareKey))
  } catch (err) {
    console.warn('this share link is not valid', err)
    return undefined
  }
}

export function useWatch(
  box: RefObject<HTMLDivElement | null>,
  host: RefObject<HTMLDivElement | null>,
  shareKey: string,
) {
  const [phase, setPhase] = useState<WatchPhase>('connecting')
  const [small, setSmall] = useState(false)

  useEffect(() => {
    const [boxEl, hostEl] = [box.current, host.current]
    if (!boxEl || !hostEl) return
    const space = openSpace(shareKey)
    if (!space) {
      setPhase('ended')
      return
    }
    let leave: (() => void) | undefined
    let left = false
    void fontReady.then(() => {
      if (!left) leave = follow(space, boxEl, hostEl, { phase: setPhase, small: setSmall })
    })
    return () => {
      left = true
      leave?.()
      space.close()
    }
  }, [box, host, shareKey])

  return { phase, small }
}

/** Shows the share in `host`, scaled to `box`, until it is over; returns how to let go. */
function follow(space: Space, box: HTMLElement, host: HTMLElement, show: Show) {
  const term = new XTerm({
    fontFamily: FONT,
    fontSize: 13,
    disableStdin: true,
    cursorBlink: false,
    scrollback: 0,
    minimumContrastRatio: MIN_CONTRAST,
    theme: { ...NIGHT, background: getComputedStyle(host).backgroundColor },
  })
  term.open(host)

  // The pane keeps its own width, which the viewer cannot change: the whole of it is scaled.
  const fit = () => {
    if (!host.offsetWidth) return
    const scale = Math.min(1, box.clientWidth / host.offsetWidth)
    host.style.transform = `scale(${scale})`
    box.style.height = `${host.offsetHeight * scale}px`
    show.small(scale < SMALL_BELOW)
  }
  const sizes = new ResizeObserver(fit)
  sizes.observe(box)
  sizes.observe(host)

  let live: Watch | undefined
  let opening = false
  let over = false
  let seenLive = false
  let lostAt: number | undefined
  let retrying: ReturnType<typeof setTimeout> | undefined

  const finish = (phase: WatchPhase) => {
    over = true
    clearTimeout(retrying)
    live?.close()
    live = undefined
    show.phase(phase)
  }

  const lost = () => {
    lostAt ??= Date.now()
    show.phase('reconnecting')
    retrying ??= setTimeout(retry, RETRY_MS)
  }

  const retry = () => {
    retrying = undefined
    if (over || live) return
    if (Date.now() - (lostAt ?? 0) > GIVE_UP_MS) return finish('ended')
    open()
    retrying = setTimeout(retry, RETRY_MS)
  }

  const onEnd = (code: string | undefined) => {
    live = undefined
    opening = false
    if (over) return
    const next = afterEnd(code)
    if (next === 'ended' || next === 'full') return finish(next)
    if (next === 'retry') return lost()
    term.reset()
    open()
  }

  const open = () => {
    const machine = space.getSnapshot().machines.find(m => m.online)
    if (over || live || opening || !machine) return
    opening = true
    let ended = false
    openWatch(space, machine.state.machine.id, {
      output: (bytes, done) => {
        lostAt = undefined
        seenLive = true
        show.phase('live')
        term.write(bytes, done)
      },
      size: (cols, rows) => term.resize(cols, rows),
      end: code => {
        ended = true
        onEnd(code)
      },
    }).then(
      watch => {
        opening = false
        if (over || ended) watch.close()
        else live = watch
      },
      (err: unknown) => {
        if (!(err instanceof CallError)) console.warn('could not open the shared terminal', err)
        onEnd(err instanceof CallError ? err.code : undefined)
      },
    )
  }

  const seen = () => {
    if (over) return
    const view = space.getSnapshot()
    if (!view.loaded) return
    if (view.machines.some(m => m.online)) open()
    else if (seenLive) lost()
    else finish('ended')
  }
  const unsubscribe = space.subscribe(seen)
  seen()

  return () => {
    over = true
    clearTimeout(retrying)
    sizes.disconnect()
    unsubscribe()
    live?.close()
    term.dispose()
  }
}
