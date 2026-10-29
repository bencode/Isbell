import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../button'

type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  closeLabel: string
  children: ReactNode
}

/** A card that rises from the bottom of a phone's screen over the page. */
export function Sheet({ open, onOpenChange, title, closeLabel, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-2xl border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] index-card-lifted outline-none">
          <div className="flex flex-none items-center gap-3 py-2 pr-2 pl-5">
            <Dialog.Title className="m-0 min-w-0 flex-1 truncate text-base font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close render={<Button variant="quiet" size="icon" />} aria-label={closeLabel}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-col gap-5 overflow-auto px-5 pt-1 pb-6 text-sm">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
