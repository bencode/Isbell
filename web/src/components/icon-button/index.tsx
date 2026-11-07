import { Tooltip } from '@base-ui/react/tooltip'
import type { ComponentProps, ReactElement } from 'react'

/** What every icon on a control takes, so strokes are the same at any size. */
export const ICON = { size: 16, strokeWidth: 1.5, absoluteStrokeWidth: true }

type Side = 'top' | 'right' | 'bottom' | 'left'

/** `label` beside `children` when pointed at; while `disabled`, nothing shows. */
export function Tip({
  label,
  side = 'bottom',
  disabled = false,
  children,
}: {
  label: string
  side?: Side
  disabled?: boolean
  children: ReactElement
}) {
  return (
    <Tooltip.Root disabled={disabled}>
      <Tooltip.Trigger render={children} />
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

type Props = ComponentProps<'button'> & {
  /** Named for screen readers, and in a tooltip, by this. */
  label: string
  side?: Side
  /** For a row, where the usual size would crowd it. */
  small?: boolean
}

/** A control that is only an icon: bare at rest, ink under it when pointed at or pressed. */
export function IconButton({ label, side = 'bottom', small = false, className = '', ...props }: Props) {
  return (
    <Tip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        className={`inline-grid flex-none ${small ? 'size-6' : 'size-7'} cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:bg-press disabled:cursor-default disabled:bg-transparent disabled:opacity-55 ${className}`}
        {...props}
      />
    </Tip>
  )
}
