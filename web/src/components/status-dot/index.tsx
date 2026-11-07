// Where an agent stands, as a dot: asking, done, running (its ring going out) or standing by.

import type { AgentStatus } from '../../model/state'

const LOOK: Record<AgentStatus, string> = {
  blocked: 'bg-warn',
  done: 'bg-ok',
  working:
    "bg-accent after:absolute after:-inset-px after:rounded-full after:bg-accent after:content-[''] after:animate-ring motion-reduce:after:hidden",
  idle: 'shadow-[inset_0_0_0_1.5px_var(--faint)]',
  unknown: 'shadow-[inset_0_0_0_1.5px_var(--faint)]',
}

/** Only seen: what it says is in words beside it, or in the name of what it marks. */
export function StatusDot({ status }: { status: AgentStatus }) {
  return <span aria-hidden className={`relative size-2 flex-none rounded-full ${LOOK[status]}`} />
}
