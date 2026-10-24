import type { AgentStatus } from '@isbell/core'
import { useT } from '../i18n'

const TONE: Record<AgentStatus, string> = {
  blocked: 'border-ask-line text-warn',
  working: 'border-ok/40 text-ok',
  done: 'border-ok/40 text-ok',
  idle: 'border-line text-muted',
  unknown: 'border-line text-faint',
}

export function StatusChip({ status }: { status: AgentStatus }) {
  const t = useT()
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[11.5px] font-semibold ${TONE[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  )
}
