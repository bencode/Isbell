import { Tooltip } from '@base-ui/react/tooltip'
import type { ReactElement } from 'react'

export type Side = 'top' | 'right' | 'bottom' | 'left'

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
