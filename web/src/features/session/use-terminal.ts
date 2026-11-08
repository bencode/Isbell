// An xterm in a tab, attached to a pane through `openTerminal`. Unmounting detaches; the pane keeps
// running.

import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal as XTerm } from '@xterm/xterm'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useSpace } from '../../core/space'
import type { Via } from '../../model/space'
import { openTerminal, type Terminal } from '../../model/terminal'

type TerminalState = {
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
 * colors for a dark background, and on paper those fade. Its background is `--term`. Bright black
 * is the shade a program lays under text where it cannot learn the background (herdr answers no
 * OSC 11), as Codex does under your messages, so it is only a little lighter than the background;
 * as text, it is lightened to `MIN_CONTRAST`. */
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
  brightBlack: '#2a303c',
  brightRed: '#ffa69d',
  brightGreen: '#8fe3b2',
  brightYellow: '#f2c77c',
  brightBlue: '#adc6ff',
  brightMagenta: '#e3b5ec',
  brightCyan: '#9edbe1',
  brightWhite: '#e9e5d9',
}

/** The least contrast text keeps with what is under it; the terminal lightens text below it. */
const MIN_CONTRAST = 3

export function useTerminal(el: RefObject<HTMLDivElement | null>, mid: string, paneId: string) {
  const space = useSpace()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<TerminalState>({ phase: 'opening' })
  // The pane takes one controller at a time: an attach waits until the one before it has let go.
  const previous = useRef<Promise<void>>(Promise.resolve())
  const xterm = useRef<XTerm | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is how Reconnect re-attaches; `attach` reads only what is listed, and refs.
  useEffect(() => {
    const host = el.current
    if (!host) return
    let cancelled = false
    let detach: (() => void) | undefined
    // A box hidden behind the chat has no size: attached there, xterm would take the pane to its
    // default 80×24. It attaches once the box is shown.
    let waiting: ResizeObserver | undefined
    const sized = new Promise<void>(resolve => {
      waiting = new ResizeObserver(([entry]) => {
        if ((entry?.contentRect.width ?? 0) > 0) resolve()
      })
      waiting.observe(host)
    })
    void Promise.all([fontReady, sized]).then(() => {
      waiting?.disconnect()
      if (!cancelled) detach = attach(host)
    })
    return () => {
      cancelled = true
      waiting?.disconnect()
      detach?.()
    }
  }, [el, space, mid, paneId, attempt])

  /** Opens an xterm in `host` and attaches it to the pane; returns how to let go of both. */
  function attach(host: HTMLDivElement) {
    const term = new XTerm({
      fontFamily: FONT,
      fontSize: 13,
      cursorBlink: true,
      minimumContrastRatio: MIN_CONTRAST,
      theme: { ...NIGHT, background: getComputedStyle(host).backgroundColor },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    term.focus()
    xterm.current = term
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

    const typed = term.onData(s => live?.input(utf8.encode(s)))
    const binary = term.onBinary(s => live?.input(Uint8Array.from(s, c => c.charCodeAt(0))))
    let settle: ReturnType<typeof setTimeout> | undefined
    // Shown again after hiding behind the chat, it takes the keys, as it does on opening.
    let shown = true
    const observer = new ResizeObserver(([entry]) => {
      const now = (entry?.contentRect.width ?? 0) > 0
      if (now && !shown) term.focus()
      shown = now
      clearTimeout(settle)
      // Hidden behind the chat it has no size: the pane keeps the one it has, for the agent in it and
      // anyone else watching it.
      if (!now) return
      settle = setTimeout(() => {
        fit.fit()
        live?.resize(term.cols, term.rows)
      }, RESIZE_SETTLE_MS)
    })
    observer.observe(host)

    return () => {
      gone = true
      clearTimeout(settle)
      observer.disconnect()
      typed.dispose()
      binary.dispose()
      previous.current = attached.then(t => t?.close())
      xterm.current = null
      term.dispose()
    }
  }

  return {
    state,
    reconnect: () => setAttempt(n => n + 1),
    /** Pastes `text` at the cursor, as the user's own paste would, and takes the keys. */
    paste: (text: string) => {
      xterm.current?.paste(text)
      xterm.current?.focus()
    },
  }
}
