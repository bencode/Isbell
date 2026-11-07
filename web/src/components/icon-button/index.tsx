import { Tooltip } from '@base-ui/react/tooltip'
import type { ComponentProps } from 'react'

/** What every icon on a control takes, so strokes are the same at any size. */
export const ICON = { size: 16, strokeWidth: 1.5, absoluteStrokeWidth: true }

type Props = ComponentProps<'button'> & {
  /** Named for screen readers, and in a tooltip, by this. */
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** A control that is only an icon: bare at rest, ink under it when pointed at or pressed. */
export function IconButton({ label, side = 'bottom', className = '', ...props }: Props) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label={label}
            className={`inline-grid size-7 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:bg-press disabled:cursor-default disabled:bg-transparent disabled:opacity-55 ${className}`}
            {...props}
          />
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={8} className="z-50">
          <Tooltip.Popup className="max-w-64 rounded-[5px] bg-text px-2 py-[3px] text-xs leading-[18px] text-bg">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
