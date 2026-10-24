import { Switch } from '@base-ui/react/switch'

export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative flex h-[22px] w-10 flex-none cursor-pointer rounded-full border border-line bg-bg p-0.5 transition-colors data-checked:border-accent data-checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Switch.Thumb className="size-4 rounded-full bg-muted transition-transform data-checked:translate-x-[18px] data-checked:bg-accent-ink" />
    </Switch.Root>
  )
}
