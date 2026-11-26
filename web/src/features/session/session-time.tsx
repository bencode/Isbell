// When a session in a list stands as it does, said the one way in every list: how long it has
// waited for you, how long it has worked, or else how long since it was last active; the moment
// itself on pointing.

import { useI18n } from '../../core/i18n'
import type { AgentStatus } from '../../model/state'
import { since } from '../../utils/time'

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
  const moment = new Date(at).toLocaleString(t.locale)
  const d = since(at, now)
  if (status === 'blocked')
    return (
      <span title={moment} className={`${base} font-semibold text-warn`}>
        {t('time.waiting', { d })}
      </span>
    )
  if (status === 'working')
    return (
      <span title={moment} className={`${base} text-accent`}>
        {t('time.working', { d })}
      </span>
    )
  return (
    <span title={moment} className={`${base} text-faint`}>
      {d}
    </span>
  )
}
