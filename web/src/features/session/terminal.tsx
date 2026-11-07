// A pane's terminal in its tab, under full control: unmounting detaches, ending is the tab's.

import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import type { Via } from '../../model/space'
import { useTerminal } from './use-terminal'

/** `onVia`: the path the terminal's stream took, for the tab's facts. */
export function Terminal({
  mid,
  paneId,
  onVia,
}: {
  mid: string
  paneId: string
  onVia: (via: Via | undefined) => void
}) {
  const t = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect } = useTerminal(box, mid, paneId)
  useEffect(() => onVia(state.via), [onVia, state.via])
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-term px-3 py-2">
        <div ref={box} className="h-full w-full bg-term" />
        {state.phase === 'ended' ? (
          <div className="absolute inset-0 grid place-items-center bg-scrim">
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
      <footer className="flex flex-none gap-4 border-t border-line px-4 py-1.5 font-mono text-xs text-faint">
        <span>
          {state.phase === 'opening' ? t('terminal.opening') : state.via ? t(`via.${state.via}`) : ''}
        </span>
        <span>{t('terminal.control')}</span>
        {state.size ? (
          <span>
            {state.size.cols}×{state.size.rows}
          </span>
        ) : null}
      </footer>
    </div>
  )
}
