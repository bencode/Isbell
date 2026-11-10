// When a session in a list stands as it does, said the one way in both columns: how long it has
// waited for you, how long it has worked, or else when it was last active.

import { useI18n } from '../../core/i18n'
import type { AgentStatus } from '../../model/state'
import { shortDay, since } from '../../utils/time'

type Props = {
  /** A running agent's status; none for a session that ran. */
  status?: AgentStatus | undefined
  /** When it came to that status, or was last active. */
  at: number
  now: number
}

export function SessionTime({ status, at, now }: Props) {
  const t = useI18n()
  const base = 'flex-none font-mono text-[11.5px] tabular-nums'
  if (status === 'blocked')
    return (
      <span className={`${base} font-semibold text-warn`}>{t('time.waiting', { d: since(at, now) })}</span>
    )
  if (status === 'working')
    return <span className={`${base} text-accent`}>{t('time.working', { d: since(at, now) })}</span>
  return <span className={`${base} text-faint`}>{shortDay(t.locale, at, now, t('sessions.yesterday'))}</span>
}
