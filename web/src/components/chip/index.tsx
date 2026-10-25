import type { AgentStatus } from '../../model/state'

const TONE: Record<AgentStatus, string> = {
  blocked: 'border-ask-line text-warn',
  working: 'border-ok/40 text-ok',
  done: 'border-ok/40 text-ok',
  idle: 'border-line text-muted',
  unknown: 'border-line text-faint',
}

export function StatusChip({ status, label }: { status: AgentStatus; label: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-[3px] border px-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase ${TONE[status]}`}
    >
      {label}
    </span>
  )
}
