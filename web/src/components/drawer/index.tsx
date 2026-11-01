import { Dialog } from '@base-ui/react/dialog'
import { type ReactNode, useRef } from 'react'

type DrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the drawer for screen readers; it shows no title of its own. */
  label: string
  children: ReactNode
}

/** A column that slides in from the left over the page, as a phone's navigation does. */
export function Drawer({ open, onOpenChange, label, children }: DrawerProps) {
  // Opened, the drawer itself holds the focus, not its first link, which a phone would ring.
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Popup
          ref={popup}
          initialFocus={popup}
          aria-label={label}
          className="fixed inset-y-0 left-0 z-50 flex w-[min(320px,86vw)] flex-col border-r border-line bg-side pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] index-card-lifted outline-none"
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
