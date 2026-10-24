import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../button'

type PanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  closeLabel: string
  children: ReactNode
  footer: ReactNode
}

/** A panel that slides in from the right, for work that needs room. */
export function SidePanel({ open, onOpenChange, title, closeLabel, children, footer }: PanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-line bg-raised shadow-2xl outline-none">
          <div className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
            <Dialog.Title className="m-0 flex-1 text-[17px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close render={<Button variant="quiet" size="icon" />} aria-label={closeLabel}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-5">{children}</div>
          <div className="flex flex-none items-center gap-2.5 border-t border-line px-5 py-3.5">{footer}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
