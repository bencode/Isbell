import { prompt } from '@isbell/core'
import { useState } from 'react'
import { Button } from '../../components/button'
import { errorText, useT } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { onSubmitKey } from '../../utils/shortcuts'

/** A reply, or something more the agent should know. */
export function Composer({ mid, paneId, onSent }: { mid: string; paneId: string; onSent: () => void }) {
  const t = useT()
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
      onSent()
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2.5 rounded-xl border border-line-strong bg-raised py-2 pr-2 pl-3.5">
        <textarea
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onSubmitKey(() => void send())}
          aria-label={t('composer.placeholder')}
          placeholder={t('composer.placeholder')}
          className="field-sizing-content max-h-48 min-h-6 flex-1 resize-none border-0 bg-transparent py-1 text-sm text-text outline-none"
        />
        <Button variant="primary" onClick={() => void send()} disabled={!text.trim() || busy}>
          {t('composer.send')}
          <span className="font-mono text-[11px] opacity-70">⌘↵</span>
        </Button>
      </div>
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
    </div>
  )
}
