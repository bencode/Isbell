// A pane's terminal in its tab, under full control: unmounting detaches, ending is the tab's.

import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { typedPath } from '../../model/files/uploads'
import type { Via } from '../../model/space'
import { Attachments, PickFiles, useAttachments } from './attachments'
import { useTerminal } from './use-terminal'

/** `machine`: the name of the machine `mid`. `onVia`: the path the terminal's stream took, for the
 * tab's facts. `sendsWheel`: whether the wheel goes to the agent in the
 * pane; a shell would print it. */
export function Terminal({
  mid,
  paneId,
  machine,
  onVia,
  sendsWheel,
}: {
  mid: string
  paneId: string
  machine: string
  onVia: (via: Via | undefined) => void
  sendsWheel: boolean
}) {
  const t = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect, paste } = useTerminal(box, mid, paneId, true, sendsWheel)
  const files = useAttachments(mid, machine, path => paste(`${typedPath(path)} `))
  useEffect(() => onVia(state.via), [onVia, state.via])
  return (
    <div className="flex h-full flex-col">
      {/* In capture, before xterm: it would take a paste of files for a paste of no text. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-term px-3 py-2"
        onPasteCapture={files.paste}
        {...files.drop}
      >
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
      {/* Of a fixed height: a taller one would shrink the terminal, and the pane with it. */}
      <footer className="flex h-8 flex-none items-center gap-4 border-t border-line px-4 font-mono text-xs text-faint">
        <span className="truncate">
          {state.phase === 'opening' ? t('terminal.opening') : state.via ? t(`via.${state.via}`) : ''}
        </span>
        <span className="truncate">{t('terminal.control')}</span>
        {state.size ? (
          <span className="truncate">
            {state.size.cols}×{state.size.rows}
          </span>
        ) : null}
        {/* Short of room, the hint gives way first, and the paperclip stays. */}
        <div className="ml-auto flex min-w-6 shrink-[100] items-center justify-end gap-2 overflow-hidden">
          <div className="max-h-[26px] min-w-0 overflow-hidden">
            <Attachments items={files.items} onRemove={files.remove} />
          </div>
          {files.problem ? <span className="truncate text-danger">{files.problem}</span> : null}
          {files.taken ? (
            <>
              <span className="truncate">{t('terminal.sendFiles')}</span>
              <PickFiles onPick={files.add} />
            </>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
