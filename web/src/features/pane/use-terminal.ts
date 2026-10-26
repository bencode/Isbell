// An xterm on the page, attached to a pane through `openTerminal`. Leaving the page detaches;
// the pane keeps running.

import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal as XTerm } from '@xterm/xterm'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useSpace } from '../../core/space'
import type { Via } from '../../model/space'
import { type BarKey, barKeyBytes, withCtrl } from '../../model/term-keys'
import { openTerminal, type Terminal } from '../../model/terminal'

export type TerminalState = {
  phase: 'opening' | 'open' | 'ended'
  via?: Via
  /** The pane's size, as the machine reports it. */
  size?: { cols: number; rows: number }
  error?: unknown
}

const FONT = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace'

/** xterm measures its cells when it opens, so it opens once its font is in. A font that fails to
 * load leaves the fallback, which only changes how the cells look. */
const fontReady: Promise<void> = document.fonts.load('13px "IBM Plex Mono"').then(
  () => undefined,
  err => console.warn('the terminal font did not load; using a fallback', err),
)
/** Resizing the window fires continuously; the pane is resized once it settles. */
const RESIZE_SETTLE_MS = 100
const utf8 = new TextEncoder()

/** The terminal stays on the night page in either theme: programs such as agents pick many of their
 * colors for a dark background, and on paper those fade. Its background is `--term`. */
const NIGHT: ITheme = {
  foreground: '#e9e5d9',
  cursor: '#8fb0ff',
  selectionBackground: '#1c2747',
  black: '#283143',
  red: '#f08a80',
  green: '#6fd39a',
  yellow: '#e6b45e',
  blue: '#8fb0ff',
  magenta: '#d39be0',
  cyan: '#7fc8cf',
  white: '#c9c5ba',
  brightBlack: '#8a92a4',
  brightRed: '#ffa69d',
  brightGreen: '#8fe3b2',
  brightYellow: '#f2c77c',
  brightBlue: '#adc6ff',
  brightMagenta: '#e3b5ec',
  brightCyan: '#9edbe1',
  brightWhite: '#e9e5d9',
}

export function useTerminal(el: RefObject<HTMLDivElement | null>, mid: string, paneId: string) {
  const space = useSpace()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<TerminalState>({ phase: 'opening' })
  // The pane takes one controller at a time: an attach waits until the one before it has let go.
  const previous = useRef<Promise<void>>(Promise.resolve())
  // A key from the bar, typed into the open xterm.
  const keyIn = useRef<((key: BarKey) => void) | null>(null)
  // Ctrl from the bar holds until the next key; `onData` reads the ref, the bar the state.
  const ctrlOn = useRef(false)
  const [ctrl, setCtrlState] = useState(false)
  const setCtrl = (on: boolean) => {
    ctrlOn.current = on
    setCtrlState(on)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is how Reconnect re-attaches; `attach` reads only what is listed.
  useEffect(() => {
    const host = el.current
    if (!host) return
    let cancelled = false
    let detach: (() => void) | undefined
    void fontReady.then(() => {
      if (!cancelled) detach = attach(host)
    })
    return () => {
      cancelled = true
      detach?.()
    }
  }, [el, space, mid, paneId, attempt])

  /** Opens an xterm in `host` and attaches it to the pane; returns how to let go of both. */
  function attach(host: HTMLDivElement) {
    const term = new XTerm({
      fontFamily: FONT,
      fontSize: 13,
      cursorBlink: true,
      theme: { ...NIGHT, background: getComputedStyle(host).backgroundColor },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    term.focus()
    setState({ phase: 'opening' })

    let live: Terminal | null = null
    let gone = false
    const attached = previous.current
      .then(() =>
        gone
          ? null
          : openTerminal(
              space,
              mid,
              { target: paneId },
              { cols: term.cols, rows: term.rows },
              {
                output: (bytes, done) => term.write(bytes, done),
                size: (cols, rows) => setState(s => ({ ...s, size: { cols, rows } })),
                end: error => setState(s => ({ ...s, phase: 'ended', error })),
              },
            ),
      )
      .then(
        t => {
          if (t && !gone) {
            live = t
            setState(s => ({ ...s, via: t.via, phase: s.phase === 'ended' ? 'ended' : 'open' }))
          }
          return t
        },
        error => {
          if (!gone) setState({ phase: 'ended', error })
          return null
        },
      )

    // The bar's keys come through here too, so any key lets go of Ctrl.
    const typed = term.onData(s => {
      const latched = ctrlOn.current
      if (latched) setCtrl(false)
      live?.input(utf8.encode(latched ? withCtrl(s) : s))
    })
    keyIn.current = key => term.input(barKeyBytes(key, term.modes.applicationCursorKeysMode), true)
    const binary = term.onBinary(s => live?.input(Uint8Array.from(s, c => c.charCodeAt(0))))
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(settle)
      settle = setTimeout(() => {
        fit.fit()
        live?.resize(term.cols, term.rows)
      }, RESIZE_SETTLE_MS)
    })
    observer.observe(host)

    return () => {
      gone = true
      keyIn.current = null
      clearTimeout(settle)
      observer.disconnect()
      typed.dispose()
      binary.dispose()
      previous.current = attached.then(t => t?.close())
      term.dispose()
    }
  }

  return {
    state,
    reconnect: () => setAttempt(n => n + 1),
    press: (key: BarKey) => keyIn.current?.(key),
    ctrl,
    toggleCtrl: () => setCtrl(!ctrlOn.current),
  }
}
