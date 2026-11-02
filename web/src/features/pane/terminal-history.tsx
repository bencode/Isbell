// A pane's history, over its terminal on a touch screen: the terminal shows only what herdr streams,
// the screen, so the lines before it are read from herdr, with their colors, into plain text that
// scrolls and can be selected. It opens at the bottom, as the terminal is.

import Anser from 'anser'
import { RotateCw, X } from 'lucide-react'
import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { readPane } from '../../model/herdr'

type Read = { text: string | null; error: unknown }

const DECORATIONS: Partial<Record<string, CSSProperties>> = {
  bold: { fontWeight: 700 },
  dim: { opacity: 0.6 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strikethrough: { textDecoration: 'line-through' },
}

/** A run of text in its colors and decorations, as styles. */
const styleOf = (e: Anser.AnserJsonEntry): CSSProperties =>
  Object.assign(
    {},
    e.fg ? { color: `rgb(${e.fg})` } : null,
    e.bg ? { backgroundColor: `rgb(${e.bg})` } : null,
    ...e.decorations.map(d => DECORATIONS[d]),
  )

/** Memoized: the page renders again on each push about its agent, and rendering the lines again
 * while a finger scrolls them stops the scroll on iOS. */
export const TerminalHistory = memo(function TerminalHistory({
  mid,
  paneId,
  onClose,
}: {
  mid: string
  paneId: string
  onClose: () => void
}) {
  const t = useI18n()
  const space = useSpace()
  const [read, setRead] = useState<Read>({ text: null, error: undefined })
  // Bumped to read again.
  const [round, setRound] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `round` is a reason to read again.
  useEffect(() => {
    // Once the effect is over, a late answer is dropped.
    let live = true
    readPane(space.call, mid, paneId).then(
      text => live && setRead({ text, error: undefined }),
      error => live && setRead(r => ({ ...r, error })),
    )
    return () => {
      live = false
    }
  }, [space, mid, paneId, round])

  const { text, error } = read
  const runs = useMemo(
    () => (text === null ? [] : Anser.ansiToJson(text, { use_classes: false, remove_empty: true })),
    [text],
  )
  // Each read opens at its bottom, the lines nearest the screen.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && text !== null) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-term font-mono text-[#e9e5d9]">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-[#2c3546] px-3 font-sans text-xs text-[#a2a8b5]">
        <b className="font-semibold text-[#e9e5d9]">{t('terminal.history')}</b>
        {text !== null ? (
          <span>{t('terminal.historyLines', { n: text ? text.split('\n').length : 0 })}</span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setRound(n => n + 1)}
          className="inline-flex h-9 cursor-pointer items-center gap-1 px-1 font-semibold text-[#8fb0ff]"
        >
          <RotateCw size={13} />
          {t('terminal.refresh')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="inline-flex size-9 cursor-pointer items-center justify-center text-[#e9e5d9]"
        >
          <X size={16} />
        </button>
      </div>
      {error ? (
        <p className="m-0 mx-3 mt-2 flex-none font-sans text-xs text-danger">{errorText(t, error)}</p>
      ) : null}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {text === null ? (
          error ? null : (
            <p className="m-0 text-xs text-faint">{t('terminal.opening')}</p>
          )
        ) : (
          <pre className="m-0 font-mono text-[12px] leading-4 break-all whitespace-pre-wrap">
            {runs.map((e, i) => (
              // Runs have no identity of their own, and are replaced whole on each read.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              <span key={i} style={styleOf(e)}>
                {e.content}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  )
})
