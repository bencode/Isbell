// The small marks the sidebar and the rail both show: how many sessions ask, and the state of a
// session, a machine and the relay.

import { type Key, useI18n } from '../core/i18n'
import type { ConnStatus } from '../model/connection'
import type { Project } from '../model/projects'
import type { AgentStatus } from '../model/state'

export function AskBadge({ n, label, className = '' }: { n: number; label: string; className?: string }) {
  return (
    <span
      title={label}
      className={`inline-flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-warn px-1 text-[11px] font-bold text-accent-ink ${className}`}
    >
      {n}
      <span className="sr-only">{label}</span>
    </span>
  )
}

// A dot for something not running or not reachable: a ring.
const OFF = 'border-[1.5px] border-faint'

const DOT: Record<AgentStatus, string> = {
  blocked: 'bg-warn',
  working: 'bg-ok',
  done: 'bg-ok',
  idle: OFF,
  unknown: OFF,
}

export const StatusDot = ({ status }: { status: AgentStatus }) => (
  <span className={`size-[7px] flex-none rounded-full ${DOT[status]}`} />
)

const RELAY: Record<ConnStatus, { key: Key; dot: string }> = {
  connecting: { key: 'side.relay.connecting', dot: OFF },
  open: { key: 'side.relay.open', dot: 'bg-ok' },
  reconnecting: { key: 'side.relay.reconnecting', dot: 'bg-warn' },
  rejected: { key: 'side.relay.rejected', dot: 'bg-danger' },
}

/** A machine: a ring while offline, green once herdr is ready on it, amber until then. */
export const MachineDot = ({ online, ready }: { online: boolean; ready: boolean }) => (
  <span className={`size-2 flex-none rounded-full ${!online ? OFF : ready ? 'bg-ok' : 'bg-warn'}`} />
)

/** How the relay connection is doing; `compact` keeps only the dot, with the words as its title. */
export function RelayStatus({ status, compact }: { status: ConnStatus; compact?: boolean }) {
  const t = useI18n()
  const { key, dot } = RELAY[status]
  const mark = <span className={`size-2 flex-none rounded-full ${dot}`} />
  if (compact)
    return (
      <span title={t(key)} className="inline-flex size-9 items-center justify-center">
        {mark}
        <span className="sr-only">{t(key)}</span>
      </span>
    )
  return (
    <span className="flex items-center gap-2.5 px-2 py-1 text-[12.5px] text-muted">
      {mark}
      {t(key)}
    </span>
  )
}

export const asking = (p: Project) => p.sessions.filter(s => s.status === 'blocked').length
