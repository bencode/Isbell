// An xterm on the page, attached to a pane through `openTerminal`. Leaving the page detaches;
// the pane keeps running.

import { openTerminal, type Terminal, type Via } from '@isbell/core'
import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal as XTerm } from '@xterm/xterm'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useLocal } from '../../core/prefs'
import { useSpace } from '../../core/space'

export type TerminalState = {
  phase: 'opening' | 'open' | 'ended'
  via?: Via
  /** The pane's size, as the machine reports it. */
  size?: { cols: number; rows: number }
  error?: unknown
}

const FONT = 'ui-monospace, "SF Mono", Menlo, monospace'
/** Resizing the window fires continuously; the pane is resized once it settles. */
const RESIZE_SETTLE_MS = 100
const utf8 = new TextEncoder()

/** The page's own colors, so the terminal follows the light or dark theme. */
const themeOf = (el: HTMLElement): ITheme => {
  const style = getComputedStyle(el)
  return { background: style.backgroundColor, foreground: style.color, cursor: style.color }
}

export function useTerminal(el: RefObject<HTMLDivElement | null>, mid: string, paneId: string) {
  const space = useSpace()
  const { prefs } = useLocal()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<TerminalState>({ phase: 'opening' })
  const xterm = useRef<XTerm | null>(null)
  // The pane takes one controller at a time: an attach waits until the one before it has let go.
  const previous = useRef<Promise<void>>(Promise.resolve())

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is how Reconnect re-attaches.
  useEffect(() => {
    const host = el.current
    if (!host) return
    const term = new XTerm({ fontFamily: FONT, fontSize: 13, cursorBlink: true, theme: themeOf(host) })
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
      clearTimeout(settle)
      observer.disconnect()
      typed.dispose()
      binary.dispose()
      previous.current = attached.then(t => t?.close())
      term.dispose()
      xterm.current = null
    }
  }, [el, space, mid, paneId, attempt])

  // Follows a theme change made in settings or by the system.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `prefs.theme` changes the page colors read here.
  useEffect(() => {
    const apply = () => {
      if (xterm.current && el.current) xterm.current.options.theme = themeOf(el.current)
    }
    apply()
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [el, prefs.theme])

  return { state, reconnect: () => setAttempt(n => n + 1) }
}
