import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { sendKeys } from '../../model/herdr'
import type { Question } from '../../model/screen/types'

/** The keys an agent's question usually takes: its numbered choices, or Esc to back out. */
const KEYS: [label: string, key: string][] = [
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['Esc', 'esc'],
]

/**
 * Shown while the agent waits for an answer: its question with the options read from the screen,
 * or, when the question could not be read, the end of its screen and keys to answer with.
 */
export function Asking({
  mid,
  paneId,
  name,
  question,
  screen,
  terminal,
  onAnswered,
}: {
  mid: string
  paneId: string
  name: string
  question: Question | undefined
  screen: string
  /** Where to answer in a way the options do not cover. */
  terminal: string
  onAnswered: () => void
}) {
  const t = useI18n()
  const { press, busy, error } = useAnswer(mid, paneId, onAnswered)
  const failed = error ? <p className="m-0 text-danger">{error}</p> : null

  if (question)
    return (
      <section className="flex flex-col gap-2.5 rounded-lg border border-ask-line bg-ask p-4">
        <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
          <span className="size-[7px] rounded-full bg-warn" />
          {t('ask.title', { name })}
        </h2>
        <p className="m-0">{question.text}</p>
        {question.detail.length ? (
          <pre className="m-0 max-h-48 overflow-auto rounded border border-line bg-raised px-3 py-2 font-mono text-[12.5px] leading-normal whitespace-pre-wrap">
            {question.detail.join('\n')}
          </pre>
        ) : null}
        <Options question={question} busy={busy} onPick={key => void press(key)} />
        <AnswerElsewhere terminal={terminal} />
        {failed}
      </section>
    )

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-ask-line bg-ask p-4">
      <h2 className="m-0 text-[15px] font-semibold">{t('ask.title', { name })}</h2>
      <ScreenKeys screen={screen} lines={14} busy={busy} onPress={key => void press(key)} />
      {failed}
    </section>
  )
}

/** Sends one key at a time: a second press while the first is on its way would answer twice. */
export function useAnswer(mid: string, paneId: string, onAnswered: (key: string) => void) {
  const t = useI18n()
  const space = useSpace()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const press = (key: string) => {
    setBusy(true)
    return sendKeys(space.call, mid, paneId, [key])
      .then(
        () => {
          setError(undefined)
          onAnswered(key)
        },
        err => setError(errorText(t, err)),
      )
      .finally(() => setBusy(false))
  }
  return { press, busy, error }
}

/** The question's numbered options, the first one marked as the agent's default. */
export function Options({
  question,
  busy,
  onPick,
}: {
  question: Question
  busy: boolean
  onPick: (key: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {question.options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onPick(o.key)}
          disabled={busy}
          className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border bg-raised py-1.5 pr-3 pl-1.5 text-left text-[13.5px] text-text hover:enabled:border-line-strong hover:enabled:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60 ${i ? 'border-line' : 'border-accent/45'}`}
        >
          <kbd className="inline-flex h-6 min-w-[30px] flex-none items-center justify-center rounded border border-line bg-bg font-mono text-[11.5px]">
            {o.key}
          </kbd>
          <span className="min-w-0 break-words">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** For an answer the options do not cover. */
export function AnswerElsewhere({ terminal }: { terminal: string }) {
  const t = useI18n()
  return (
    <span className="text-[12.5px] text-muted">
      {t('ask.other')}{' '}
      <Link to={terminal} className="text-accent no-underline hover:underline">
        {t('ask.inTerminal')}
      </Link>
    </span>
  )
}

/** The last `lines` of the screen, and the keys a question usually takes. */
export function ScreenKeys({
  screen,
  lines,
  busy,
  onPress,
}: {
  screen: string
  lines: number
  busy: boolean
  onPress: (key: string) => void
}) {
  const t = useI18n()
  const tail = screen.trimEnd().split('\n').slice(-lines).join('\n')
  return (
    <>
      <pre className="m-0 max-h-72 overflow-auto rounded-lg bg-bg p-3 font-mono text-[12.5px] leading-snug whitespace-pre-wrap text-text">
        {tail}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        {KEYS.map(([label, key]) => (
          <Button
            key={key}
            onClick={() => onPress(key)}
            disabled={busy}
            className="min-w-11 justify-center font-mono"
          >
            {label}
          </Button>
        ))}
        <span className="text-[13px] text-muted">{t('ask.keys')}</span>
      </div>
    </>
  )
}
