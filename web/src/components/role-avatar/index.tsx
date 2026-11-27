// An agent as a round face: the first character of its role's name, or of what it is called, on one
// of five hues the name always gets, with the dot of where it stands at its corner.

import type { AgentStatus } from '../../model/state'
import { StatusDot } from '../status-dot'

// Written out whole, for Tailwind to find them.
const HUES = [
  'bg-hue-0 text-hue-0-ink',
  'bg-hue-1 text-hue-1-ink',
  'bg-hue-2 text-hue-2-ink',
  'bg-hue-3 text-hue-3-ink',
  'bg-hue-4 text-hue-4-ink',
]

const hueOf = (name: string) =>
  HUES[[...name].reduce((sum, c) => sum + (c.codePointAt(0) ?? 0), 0) % HUES.length]

const SIZES = { md: 'size-[30px] text-[13px]', sm: 'size-[22px] text-[11px]' }

/** Only seen: its name is in words beside it. */
export function RoleAvatar({
  name,
  status,
  size = 'md',
}: {
  name: string
  status?: AgentStatus
  size?: keyof typeof SIZES
}) {
  return (
    <span
      aria-hidden
      className={`relative grid flex-none place-items-center rounded-full font-bold ${SIZES[size]} ${hueOf(name)}`}
    >
      {[...name.trim()][0]?.toUpperCase() ?? '·'}
      {status ? (
        <span className="absolute -right-px -bottom-px grid place-items-center rounded-full bg-raised p-[2px]">
          <StatusDot status={status} />
        </span>
      ) : null}
    </span>
  )
}
