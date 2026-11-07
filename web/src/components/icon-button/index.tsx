import type { ComponentProps } from 'react'
import { type Side, Tip } from '../tip'

/** What every icon on a control takes, so strokes are the same at any size. */
export const ICON = { size: 16, strokeWidth: 1.5, absoluteStrokeWidth: true }

type Props = ComponentProps<'button'> & {
  /** Named for screen readers, and in a tooltip, by this. */
  label: string
  side?: Side
  /** Smaller, where the usual size would crowd it: a row's (`small`), a tab's (`tiny`). */
  size?: 'normal' | 'small' | 'tiny'
}

const SIZE = { normal: 'size-7', small: 'size-6', tiny: 'size-5' }

/** A control that is only an icon: bare at rest, ink under it when pointed at or pressed. */
export function IconButton({ label, side = 'bottom', size = 'normal', className = '', ...props }: Props) {
  return (
    <Tip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        className={`inline-grid flex-none ${SIZE[size]} cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:bg-press disabled:cursor-default disabled:bg-transparent disabled:opacity-55 ${className}`}
        {...props}
      />
    </Tip>
  )
}
