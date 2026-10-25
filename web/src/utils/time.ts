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
