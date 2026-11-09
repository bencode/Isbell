// A session's scheduled message: what to send, when, and whether to clear the context first; and, for
// one that exists, how it has gone and pausing or removing it.

import { useState } from 'react'
import { Button } from '../../../components/button'
import { Segmented } from '../../../components/segmented'
import { errorText, type T, useI18n } from '../../../core/i18n'
import { changeLoops } from '../../../core/loops'
import { useSpace } from '../../../core/space'
import type { Loop, LoopRun, Schedule } from '../../../model/loops'

type Mode = 'every' | 'daily'
type Unit = 'minutes' | 'hours'
type Context = 'keep' | 'clear'

type Props = {
  mid: string
  paneId: string
  project: string
  loop: Loop | undefined
  run: LoopRun | undefined
  onDone: () => void
}

const FIELD =
  'rounded-md border border-line bg-bg px-2 text-[13px] text-text outline-none focus:border-accent'
const LABEL = 'text-xs font-semibold text-faint'

/** Far above any real schedule, and small enough for the gateway's numbers once in minutes: a value it
 * cannot read would stop every loop on the machine. */
const COUNT_MAX = 1_000_000

const isCount = (text: string) =>
  Number.isInteger(Number(text)) && Number(text) >= 1 && Number(text) <= COUNT_MAX

const initialEvery = (schedule: Schedule | undefined): { amount: string; unit: Unit } => {
  const minutes = schedule && 'everyMinutes' in schedule ? schedule.everyMinutes : 30
  return minutes % 60 === 0
    ? { amount: String(minutes / 60), unit: 'hours' }
    : { amount: String(minutes), unit: 'minutes' }
}

const when = (t: T, ms: number) =>
  new Date(ms).toLocaleString(t.locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function Status({ loop, run }: { loop: Loop; run: LoopRun | undefined }) {
  const t = useI18n()
  const parts = [
    t(loop.enabled ? 'loop.active' : 'loop.paused'),
    loop.enabled && !run ? t('loop.waiting') : undefined,
    loop.enabled && run?.nextRunAt ? t('loop.next', { at: when(t, run.nextRunAt) }) : undefined,
    run?.lastResult ? t(`loop.result.${run.lastResult}`) : undefined,
  ]
  return <p className="m-0 text-xs text-muted">{parts.filter(Boolean).join(' · ')}</p>
}

export function LoopForm({ mid, paneId, project, loop, run, onDone }: Props) {
  const t = useI18n()
  const { openStream } = useSpace()
  const schedule = loop?.schedule
  const [message, setMessage] = useState(loop?.message ?? '')
  const [mode, setMode] = useState<Mode>(schedule && 'dailyAt' in schedule ? 'daily' : 'every')
  const [{ amount, unit }, setEvery] = useState(() => initialEvery(schedule))
  const [time, setTime] = useState(schedule && 'dailyAt' in schedule ? schedule.dailyAt : '08:00')
  const [context, setContext] = useState<Context>(loop?.clearEvery ? 'clear' : 'keep')
  const [clearEvery, setClearEvery] = useState(String(loop?.clearEvery ?? 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const valid =
    !!message.trim() &&
    (mode === 'daily' ? /^\d\d:\d\d$/.test(time) : isCount(amount)) &&
    (context === 'keep' || isCount(clearEvery))

  const apply = async (change: (loops: Loop[]) => Loop[]) => {
    setBusy(true)
    setError(undefined)
    try {
      await changeLoops(openStream, mid, change)
      onDone()
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }

  const save = () => {
    const next: Loop = {
      id: loop?.id ?? crypto.randomUUID(),
      project,
      paneId,
      schedule:
        mode === 'daily' ? { dailyAt: time } : { everyMinutes: Number(amount) * (unit === 'hours' ? 60 : 1) },
      message: message.trim(),
      ...(context === 'clear' ? { clearEvery: Number(clearEvery) } : {}),
      enabled: loop?.enabled ?? true,
    }
    void apply(loops => [...loops.filter(l => l.paneId !== paneId), next])
  }

  const toggle = (id: string) =>
    void apply(loops => loops.map(l => (l.id === id ? { ...l, enabled: !l.enabled } : l)))
  const remove = (id: string) => void apply(loops => loops.filter(l => l.id !== id))

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[13.5px] font-semibold">{t('loop.title')}</h3>
        {loop ? <Status loop={loop} run={run} /> : null}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>{t('loop.message')}</span>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('loop.placeholder')}
          rows={4}
          className={`${FIELD} resize-y py-1.5 leading-5`}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t('loop.when')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t('loop.when')}
            value={mode}
            onChange={setMode}
            segments={[
              { value: 'every', label: t('loop.every') },
              { value: 'daily', label: t('loop.daily') },
            ]}
          />
          {mode === 'daily' ? (
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              aria-label={t('loop.daily')}
              className={`${FIELD} h-[34px]`}
            />
          ) : (
            <>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={e => setEvery({ amount: e.target.value, unit })}
                aria-label={t('loop.every')}
                className={`${FIELD} h-[34px] w-16`}
              />
              <Segmented
                label={t('loop.unit')}
                value={unit}
                onChange={next => setEvery({ amount, unit: next })}
                segments={[
                  { value: 'minutes', label: t('loop.minutes') },
                  { value: 'hours', label: t('loop.hours') },
                ]}
              />
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>{t('loop.context')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t('loop.context')}
            value={context}
            onChange={setContext}
            segments={[
              { value: 'keep', label: t('loop.keep') },
              { value: 'clear', label: t('loop.clear') },
            ]}
          />
          {context === 'clear' ? (
            <label className="flex items-center gap-1.5 text-muted">
              {t('loop.clearBefore')}
              <input
                type="number"
                min={1}
                value={clearEvery}
                onChange={e => setClearEvery(e.target.value)}
                className={`${FIELD} h-[34px] w-14`}
              />
              {t('loop.clearAfter')}
            </label>
          ) : null}
        </div>
      </div>
      <p className="m-0 text-xs leading-[18px] text-faint">{t('loop.help')}</p>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
      <div className="flex items-center gap-1.5">
        {loop ? (
          <>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => toggle(loop.id)}>
              {t(loop.enabled ? 'loop.pause' : 'loop.resume')}
            </Button>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => remove(loop.id)}>
              {t('loop.delete')}
            </Button>
          </>
        ) : null}
        <Button size="small" variant="primary" disabled={busy || !valid} onClick={save} className="ml-auto">
          {t(loop ? 'loop.save' : 'loop.create')}
        </Button>
      </div>
    </>
  )
}
