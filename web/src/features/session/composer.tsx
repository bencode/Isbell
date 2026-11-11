import { Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { prompt, sendKeys } from '../../model/herdr'
import { onSubmitKey } from '../../utils/submit-key'
import { Attachments, PickFiles, useAttachments } from './attachments'
import { useVoice, VOICE_LABEL, VoiceIcon, VoicePill } from './voice'

/** A reply, or something more the agent should know. `machine`: the name of the agent's machine;
 * where it takes files, those pasted, dropped or picked go along, the reply naming where they
 * landed. `stoppable`: the agent is at work, and can be stopped with the key it stops on. */
export function Composer({
  mid,
  paneId,
  onSent,
  onDraft,
  machine,
  stoppable,
}: {
  mid: string
  paneId: string
  onSent: (text: string) => void
  /** Something is written or attached, so the reply must not be lost with its tab. */
  onDraft: () => void
  machine: string
  stoppable: boolean
}) {
  const t = useI18n()
  const { text, setText, send, stop, stopping, ready, error, files, voice } = useComposer({
    mid,
    paneId,
    onSent,
    onDraft,
    machine,
  })

  const field = (
    <textarea
      rows={1}
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={onSubmitKey(() => void send())}
      onPaste={files.paste}
      aria-label={t('composer.placeholder')}
      placeholder={t('composer.placeholder')}
      className="field-sizing-content max-h-48 min-h-6 flex-1 resize-none border-0 bg-transparent py-1 text-sm text-text outline-none placeholder:text-faint"
    />
  )
  return (
    <div className="flex flex-col gap-1.5">
      <div
        {...files.drop}
        className="relative flex flex-col gap-2 rounded-xl border border-line-strong bg-raised py-2 pr-2 pl-3.5 focus-within:border-accent"
      >
        <VoicePill voice={voice} className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2" />
        <Attachments items={files.items} onRemove={files.remove} />
        <div className="flex items-end gap-2.5">
          {field}
          {voice.available ? (
            <Button
              size="icon"
              variant={voice.state === 'recording' ? 'danger' : 'quiet'}
              onClick={voice.toggle}
              disabled={voice.state === 'working'}
              aria-label={t(VOICE_LABEL[voice.state])}
              title={t(VOICE_LABEL[voice.state])}
            >
              <VoiceIcon state={voice.state} size={16} />
            </Button>
          ) : null}
          {stoppable ? (
            <Button onClick={stop} disabled={stopping}>
              <Square size={11} fill="currentColor" />
              {t('chat.stop')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void send()} disabled={!ready}>
            {t('composer.send')}
            <span className="font-mono text-[11px] opacity-70">↵</span>
          </Button>
        </div>
      </div>
      {files.taken ? (
        <div className="-ml-1 flex min-w-0 items-center gap-2.5">
          <PickFiles onPick={files.add} />
        </div>
      ) : null}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      {files.problem ? <p className="m-0 text-[13px] text-danger">{files.problem}</p> : null}
      {voice.error ? <p className="m-0 text-[13px] text-danger">{voice.error}</p> : null}
    </div>
  )
}

/** A reply being written, whatever it is laid out as: its words and files, sending it, and stopping
 * the agent. */
export function useComposer({
  mid,
  paneId,
  onSent,
  onDraft,
  machine,
}: {
  mid: string
  paneId: string
  onSent: (text: string) => void
  onDraft?: () => void
  machine: string
}) {
  const t = useI18n()
  const space = useSpace()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const files = useAttachments(mid, machine)
  // What is said goes after what is written, on a line of its own.
  const voice = useVoice(said =>
    setText(written => (written.trim() ? `${written.trimEnd()}\n${said}` : said)),
  )
  const message = [text.trim(), ...files.paths].filter(Boolean).join('\n')
  const drafting = text.trim() !== '' || files.items.length > 0
  useEffect(() => {
    if (drafting) onDraft?.()
  }, [drafting, onDraft])

  const send = async () => {
    if (!message || busy || files.uploading) return
    setBusy(true)
    try {
      await prompt(space.call, mid, paneId, message)
      setText('')
      files.clear()
      setError(undefined)
      onSent(message)
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  const [stopping, setStopping] = useState(false)
  const stop = () => {
    setStopping(true)
    sendKeys(space.call, mid, paneId, ['esc'])
      .then(
        () => setError(undefined),
        (err: unknown) => setError(errorText(t, err)),
      )
      .finally(() => setStopping(false))
  }

  const ready = !!message && !busy && !files.uploading
  return { text, setText, send, stop, stopping, ready, drafting, error, files, voice }
}
