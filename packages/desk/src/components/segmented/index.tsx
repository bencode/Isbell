import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'

export type Segment<V extends string> = { value: V; label: ReactNode }

/** Pick exactly one of a few: pressing the current one keeps it. */
export function Segmented<V extends string>({
  value,
  onChange,
  segments,
  label,
}: {
  value: V
  onChange: (value: V) => void
  segments: Segment<V>[]
  label: string
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={values => {
        const next = values[0] as V | undefined
        if (next) onChange(next)
      }}
      className="inline-flex gap-0.5 rounded-lg border border-line bg-bg p-0.5"
    >
      {segments.map(s => (
        <Toggle
          key={s.value}
          value={s.value}
          className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-3 text-[13px] font-medium text-muted outline-none data-pressed:bg-raised data-pressed:text-text data-pressed:index-card focus-visible:outline-2 focus-visible:outline-accent"
        >
          {s.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
