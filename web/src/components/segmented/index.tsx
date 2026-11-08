import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'

export type Segment<V extends string> = { value: V; label: ReactNode }

const GROUP = 'inline-flex gap-0.5 rounded-lg border border-line bg-bg p-0.5'
const SEGMENT =
  'inline-flex h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border-0 bg-transparent px-3 text-[13px] font-medium text-muted outline-none data-pressed:bg-raised data-pressed:text-text data-pressed:index-card focus-visible:outline-2 focus-visible:outline-accent'
const COMPACT_GROUP = 'mr-1.5 inline-flex flex-none rounded-[7px] bg-hover p-0.5'
const COMPACT_SEGMENT =
  'h-[22px] cursor-pointer rounded-[5px] border-0 bg-transparent px-2.5 text-xs text-muted transition-colors duration-75 outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-pressed:bg-raised data-pressed:font-medium data-pressed:text-text data-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)]'

/** Pick exactly one of a few: pressing the current one keeps it. */
export function Segmented<V extends string>({
  value,
  onChange,
  segments,
  label,
  compact = false,
}: {
  value: V
  onChange: (value: V) => void
  segments: Segment<V>[]
  label: string
  /** For a bar: lower, and set off from the tools after it. */
  compact?: boolean
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={values => {
        const next = values[0] as V | undefined
        if (next) onChange(next)
      }}
      className={compact ? COMPACT_GROUP : GROUP}
    >
      {segments.map(s => (
        <Toggle key={s.value} value={s.value} className={compact ? COMPACT_SEGMENT : SEGMENT}>
          {s.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
