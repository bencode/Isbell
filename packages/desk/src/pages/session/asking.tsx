import { sendKeys } from '@isbell/core'
import { useState } from 'react'
import { errorText, useT } from '../../i18n'
import { useSpace } from '../../space'
import { Button } from '../../ui/button'

/** The keys an agent's question usually takes: its numbered choices, or Esc to back out. */
const KEYS: [label: string, key: string][] = [
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['Esc', 'esc'],
]

/** Shown while the agent waits for an answer: the end of its screen, and keys to answer with. */
export function Asking({
  mid,
  paneId,
  name,
  screen,
}: {
  mid: string
  paneId: string
  name: string
  screen: string
}) {
  const t = useT()
  const space = useSpace()
  const [error, setError] = useState<string>()
  const tail = screen.trimEnd().split('\n').slice(-14).join('\n')
  const press = (key: string) =>
    sendKeys(space.call, mid, paneId, [key]).then(
      () => setError(undefined),
      err => setError(errorText(t, err)),
    )
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-ask-line bg-ask p-4">
      <h2 className="m-0 text-[15px] font-semibold">{t('ask.title', { name })}</h2>
      <pre className="m-0 max-h-72 overflow-auto rounded-lg bg-bg p-3 font-mono text-[12.5px] leading-snug whitespace-pre-wrap text-text">
        {tail}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        {KEYS.map(([label, key]) => (
          <Button key={key} onClick={() => void press(key)} className="min-w-11 justify-center font-mono">
            {label}
          </Button>
        ))}
        <span className="text-[13px] text-muted">{t('ask.keys')}</span>
      </div>
      {error ? <p className="m-0 text-danger">{error}</p> : null}
    </section>
  )
}
