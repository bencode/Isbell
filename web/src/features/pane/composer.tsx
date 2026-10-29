import { CornerDownLeft, Paperclip } from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { prompt } from '../../model/herdr'
import { onSubmitKey } from '../../utils/shortcuts'
import { Attachments, useAttachments } from './attachments'

/** A reply, or something more the agent should know. `compact`, a card's: one quiet line whose
 * send key lights up once there is something to send. With `uploads`, the agent's machine and
 * whether it takes files, files pasted, dropped or picked go along, the reply naming where they
 * landed. */
export function Composer({
  mid,
  paneId,
  onSent,
  compact = false,
  uploads,
}: {
  mid: string
  paneId: string
  onSent: (text: string) => void
  compact?: boolean
  uploads?: { machine: string; taken: boolean }
}) {
  const t = useI18n()
  const space = useSpace()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const files = useAttachments(mid, uploads?.machine ?? '', uploads?.taken === true)
  const picker = useRef<HTMLInputElement>(null)
  const message = [text.trim(), ...files.paths].filter(Boolean).join('\n')

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

  const field = (
    <textarea
      rows={1}
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={onSubmitKey(() => void send())}
      onPaste={
        uploads
          ? e => {
              const pasted = [...e.clipboardData.files]
              if (!pasted.length) return
              e.preventDefault()
              files.add(pasted)
            }
          : undefined
      }
      aria-label={t('composer.placeholder')}
      placeholder={t(compact ? 'composer.short' : 'composer.placeholder')}
      className={`field-sizing-content max-h-48 flex-1 resize-none border-0 bg-transparent text-text outline-none placeholder:text-faint ${compact ? 'min-h-5 py-0.5 text-[13px]' : 'min-h-6 py-1 text-sm'}`}
    />
  )
  const ready = !!message && !busy && !files.uploading
  const drop = uploads
    ? {
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        },
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          files.add([...e.dataTransfer.files])
        },
      }
    : {}
  return (
    <div className="flex flex-col gap-1.5">
      {compact ? (
        <div className="flex items-end gap-1.5 rounded-md border border-line bg-bg/60 py-1 pr-1 pl-2.5 focus-within:border-line-strong focus-within:bg-bg">
          {field}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!ready}
            aria-label={t('composer.send')}
            title={t('composer.send')}
            className={`inline-flex size-6 flex-none items-center justify-center rounded border-0 ${ready ? 'cursor-pointer bg-accent text-accent-ink' : 'bg-transparent text-faint'}`}
          >
            <CornerDownLeft size={13} />
          </button>
        </div>
      ) : (
        <div
          {...drop}
          className="flex flex-col gap-2 rounded-lg border border-line-strong bg-raised py-2 pr-2 pl-3.5"
        >
          <Attachments items={files.items} onRemove={files.remove} />
          <div className="flex items-end gap-2.5">
            {field}
            {uploads?.taken ? (
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
                  className="inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-raised-2 hover:text-text"
                >
                  <Paperclip size={16} />
                </button>
              </>
            ) : null}
            <Button variant="primary" onClick={() => void send()} disabled={!ready}>
              {t('composer.send')}
              <span className="font-mono text-[11px] opacity-70">↵</span>
            </Button>
          </div>
        </div>
      )}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      {files.problem ? <p className="m-0 text-[13px] text-danger">{files.problem}</p> : null}
    </div>
  )
}
