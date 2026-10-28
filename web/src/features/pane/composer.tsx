import { CornerDownLeft } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { prompt } from '../../model/herdr'
import { onSubmitKey } from '../../utils/shortcuts'

/** A reply, or something more the agent should know. `compact`, a card's: one quiet line whose
 * send key lights up once there is something to send. */
export function Composer({
  mid,
  paneId,
  onSent,
  compact = false,
}: {
  mid: string
  paneId: string
  onSent: (text: string) => void
  compact?: boolean
}) {
  const t = useI18n()
  const space = useSpace()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    try {
      await prompt(space.call, mid, paneId, message)
      setText('')
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
      aria-label={t('composer.placeholder')}
      placeholder={t(compact ? 'composer.short' : 'composer.placeholder')}
      className={`field-sizing-content max-h-48 flex-1 resize-none border-0 bg-transparent text-text outline-none placeholder:text-faint ${compact ? 'min-h-5 py-0.5 text-[13px]' : 'min-h-6 py-1 text-sm'}`}
    />
  )
  const ready = !!text.trim() && !busy
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
        <div className="flex items-end gap-2.5 rounded-lg border border-line-strong bg-raised py-2 pr-2 pl-3.5">
          {field}
          <Button variant="primary" onClick={() => void send()} disabled={!ready}>
            {t('composer.send')}
            <span className="font-mono text-[11px] opacity-70">↵</span>
          </Button>
        </div>
      )}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
    </div>
  )
}
