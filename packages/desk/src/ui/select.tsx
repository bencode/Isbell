import { Select } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export type Option = { value: string; label: ReactNode; hint?: string }
export type OptionGroup = { label?: string; options: Option[] }

type SelectProps = {
  value: string | null
  onChange: (value: string) => void
  groups: OptionGroup[]
  placeholder: string
  disabled?: boolean
  /** Shown under the options, such as a way to add one. */
  extra?: ReactNode
  id?: string
}

export function SelectBox({ value, onChange, groups, placeholder, disabled, extra, id }: SelectProps) {
  const items = groups.flatMap(g => g.options)
  const selected = items.find(o => o.value === value)
  return (
    <Select.Root value={value} onValueChange={v => v !== null && onChange(v)} disabled={disabled ?? false}>
      <Select.Trigger
        id={id}
        className="flex h-[38px] w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg px-3 text-left text-sm text-text outline-none focus-visible:outline-2 focus-visible:outline-accent data-disabled:cursor-default data-disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              {selected.label}
              {selected.hint ? <span className="ml-2 text-[12.5px] text-faint">{selected.hint}</span> : null}
            </>
          ) : (
            <span className="text-faint">{placeholder}</span>
          )}
        </span>
        <Select.Icon className="text-faint">
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[60] outline-none">
          <Select.Popup className="max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] overflow-auto rounded-xl border border-line bg-raised-2 p-1.5 shadow-2xl outline-none">
            <Select.List>
              {groups.map(group => (
                <Select.Group key={group.label ?? ''}>
                  {group.label ? (
                    <Select.GroupLabel className="px-2.5 pt-2 pb-1 text-xs font-semibold text-faint">
                      {group.label}
                    </Select.GroupLabel>
                  ) : null}
                  {group.options.map(o => (
                    <Select.Item
                      key={o.value}
                      value={o.value}
                      className="grid cursor-pointer grid-cols-[16px_1fr_auto] items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-raised"
                    >
                      <Select.ItemIndicator className="text-accent">
                        <Check size={14} />
                      </Select.ItemIndicator>
                      <Select.ItemText className="col-start-2">{o.label}</Select.ItemText>
                      {o.hint ? <span className="font-mono text-xs text-faint">{o.hint}</span> : null}
                    </Select.Item>
                  ))}
                </Select.Group>
              ))}
            </Select.List>
            {extra}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
