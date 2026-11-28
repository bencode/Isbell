// A pane's terminal in its tab, under full control: unmounting detaches, ending is the tab's. On a
// tablet it takes a finger as the phone's does: the keys a touch keyboard lacks under it, the keyboard
// up only when asked for, and the page kept to what the keyboard leaves of it.

import '@xterm/xterm/css/xterm.css'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { typedPath } from '../../model/files/uploads'
import type { Via } from '../../model/space'
import { COARSE } from '../../utils/phone'
import { Attachments, PickFiles, useAttachments } from './attachments'
import { KeyBar } from './key-bar'
import { useTerminal } from './use-terminal'
import { useVisibleArea, type VisibleArea } from './visible-area'
import { useVoice, useVoiceKey, VOICE_KEY, VOICE_LABEL, VoiceIcon, VoicePill } from './voice'

/** `machine`: the name of the machine `mid`. `onVia`: the path the terminal's stream took, for the
 * tab's facts. `sendsWheel`: whether the wheel goes to the agent in the
 * pane; a shell would print it. `shown`: whether it shows, rather than the chat. */
export function Terminal({
  mid,
  paneId,
  machine,
  onVia,
  sendsWheel,
  shown,
}: {
  mid: string
  paneId: string
  machine: string
  onVia: (via: Via | undefined) => void
  sendsWheel: boolean
  shown: boolean
}) {
  const t = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect, paste, press, toggleKeyboard } = useTerminal(
    box,
    mid,
    paneId,
    !COARSE,
    sendsWheel,
  )
  const area = useVisibleArea()
  useAboveKeyboard(COARSE && shown && area?.keyboard ? area : undefined)
  const files = useAttachments(mid, machine, path => paste(`${typedPath(path)} `))
  // What is said is pasted at the cursor, as a paste of text is: nothing is sent until Enter.
  const voice = useVoice(paste)
  // Stopping is always open; starting, only into a terminal that would take the words.
  const voiceOpen = voice.state === 'recording' || (voice.state === 'idle' && state.phase === 'open')
  const voiceKey = useVoiceKey(() => {
    if (voiceOpen) voice.toggle()
  })
  useEffect(() => onVia(state.via), [onVia, state.via])
  return (
    <div className="flex h-full flex-col">
      {/* In capture, before xterm: it would take a paste of files for a paste of no text. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-term px-3 py-2"
        onPasteCapture={files.paste}
        {...files.drop}
        {...(voice.available ? voiceKey : {})}
      >
        <div ref={box} className="h-full w-full bg-term" />
        <VoicePill
          voice={voice}
          hint={t('voice.again', { key: VOICE_KEY })}
          className="absolute bottom-3 left-1/2 -translate-x-1/2"
        />
        {state.phase === 'ended' ? (
          <div className="absolute inset-0 grid place-items-center bg-scrim">
            <div className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-line bg-raised p-5 index-card-lifted">
              {/* Ended by herdr with no error: another screen took it over, or the pane closed. */}
              <p className="m-0 font-semibold">{t(state.error ? 'terminal.ended' : 'terminal.takenOver')}</p>
              {state.error ? <p className="m-0 text-[13px] text-muted">{errorText(t, state.error)}</p> : null}
              <Button variant="primary" onClick={reconnect}>
                {t(state.error ? 'terminal.reconnect' : 'terminal.takeBack')}
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
        {voice.error ? <span className="truncate text-danger">{voice.error}</span> : null}
        {voice.available && !voice.error && !COARSE ? (
          <span className="min-w-0 shrink-[50] truncate">{t('voice.keyHint', { key: VOICE_KEY })}</span>
        ) : null}
        {voice.available && !COARSE ? (
          <button
            type="button"
            onClick={voice.toggle}
            disabled={!voiceOpen}
            aria-label={t(VOICE_LABEL[voice.state])}
            title={`${t(VOICE_LABEL[voice.state])} (${VOICE_KEY})`}
            className={`-mr-1 inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent hover:bg-raised-2 disabled:cursor-default disabled:opacity-50 ${voice.state === 'recording' ? 'text-danger' : 'text-muted hover:text-text'}`}
          >
            <VoiceIcon state={voice.state} size={14} />
          </button>
        ) : null}
      </footer>
      {COARSE ? (
        <div className="flex-none bg-[#161c27]">
          <KeyBar
            wide
            live={state.phase === 'open'}
            keyboard={!!area?.keyboard}
            onKeyboard={toggleKeyboard}
            onKey={press}
            voice={voice.available ? voice : undefined}
          />
        </div>
      ) : null}
    </div>
  )
}

/** Keeps the page to `area` while given one: on a tablet the keyboard is laid over the page, the rail
 * and the columns with it. */
function useAboveKeyboard(area: VisibleArea | undefined) {
  useLayoutEffect(() => {
    if (!area) return
    const root = document.documentElement
    root.dataset.viewport = 'visual'
    root.style.setProperty('--visible-top', `${area.top}px`)
    root.style.setProperty('--visible-height', `${area.height}px`)
    return () => {
      delete root.dataset.viewport
      root.style.removeProperty('--visible-top')
      root.style.removeProperty('--visible-height')
    }
  }, [area])
}
