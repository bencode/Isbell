import { Paperclip, Square } from 'lucide-react'
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { prompt, sendKeys } from '../../model/herdr'
import { onSubmitKey } from '../../utils/submit-key'
import { Attachments, useAttachments } from './attachments'

/** A reply, or something more the agent should know. `uploads`: the agent's machine and whether it
 * takes files; where it does, files pasted, dropped or picked go along, the reply naming where they
 * landed. `below` goes in the row under it, after the button that picks files. `stoppable`: the
 * agent is at work, and can be stopped with the key it stops on. */
export function Composer({
  mid,
  paneId,
  onSent,
  onDraft,
  uploads,
  stoppable,
  below,
}: {
  mid: string
  paneId: string
  onSent: (text: string) => void
  /** Something is written or attached, so the reply must not be lost with its tab. */
  onDraft: () => void
  uploads: { machine: string; taken: boolean }
  stoppable: boolean
  below?: ReactNode
}) {
  const t = useI18n()
  const space = useSpace()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const files = useAttachments(mid, uploads.machine, uploads.taken)
  const picker = useRef<HTMLInputElement>(null)
  const message = [text.trim(), ...files.paths].filter(Boolean).join('\n')
  const drafting = text.trim() !== '' || files.items.length > 0
  useEffect(() => {
    if (drafting) onDraft()
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

  const field = (
    <textarea
      rows={1}
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={onSubmitKey(() => void send())}
      onPaste={e => {
        const pasted = [...e.clipboardData.files]
        if (!pasted.length) return
        e.preventDefault()
        files.add(pasted)
      }}
      aria-label={t('composer.placeholder')}
      placeholder={t('composer.placeholder')}
      className="field-sizing-content max-h-48 min-h-6 flex-1 resize-none border-0 bg-transparent py-1 text-sm text-text outline-none placeholder:text-faint"
    />
  )
  const ready = !!message && !busy && !files.uploading
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault()
    },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      files.add([...e.dataTransfer.files])
    },
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div
        {...drop}
        className="flex flex-col gap-2 rounded-xl border border-line-strong bg-raised py-2 pr-2 pl-3.5 focus-within:border-accent"
      >
        <Attachments items={files.items} onRemove={files.remove} />
        <div className="flex items-end gap-2.5">
          {field}
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
      {uploads.taken || below ? (
        <div className="flex min-w-0 items-center gap-2.5">
          {uploads.taken ? (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={e => {
                  files.add([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                aria-label={t('upload.attach')}
                title={t('upload.attach')}
                className="-ml-1 inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised-2 hover:text-text"
              >
                <Paperclip size={15} />
              </button>
            </>
          ) : null}
          {below}
        </div>
      ) : null}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      {files.problem ? <p className="m-0 text-[13px] text-danger">{files.problem}</p> : null}
    </div>
  )
}
