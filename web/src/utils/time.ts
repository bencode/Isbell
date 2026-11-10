import { useEffect, useState } from 'react'

/** Re-renders every `everyMs`, for "4m ago" style times. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

export function since(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

/** The time of day `ms` was, as the locale writes it. */
export const clock = (locale: string, ms: number) =>
  new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

const DAY_MS = 24 * 60 * 60 * 1000
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/** The local day `ms` was in, said as today, yesterday, or its date. */
export function dayTitle(
  locale: string,
  ms: number,
  now: number,
  words: { today: string; yesterday: string },
) {
  if (sameDay(ms, now)) return words.today
  if (sameDay(ms, now - DAY_MS)) return words.yesterday
  return new Date(ms).toLocaleDateString(locale, { month: 'long', day: 'numeric' })
}

/** When `ms` was, in short: its time of day today, `yesterday` the day before, its date before that. */
export function shortDay(locale: string, ms: number, now: number, yesterday: string) {
  if (sameDay(ms, now)) return clock(locale, ms)
  if (sameDay(ms, now - DAY_MS)) return yesterday
  return new Date(ms).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
}

/** How long something took: 48s, 2m 41s, 1h 3m. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
