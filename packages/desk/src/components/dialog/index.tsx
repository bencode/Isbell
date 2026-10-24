import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../button'

const BACKDROP = 'fixed inset-0 z-40 bg-scrim'
const POPUP =
  'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-xl border border-line bg-raised p-6 shadow-2xl outline-none'

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  closeLabel: string
  children: ReactNode
}

export function Modal({ open, onOpenChange, title, closeLabel, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={POPUP}>
          <div className="flex items-center gap-3">
            <Dialog.Title className="m-0 flex-1 text-[17px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close render={<Button variant="quiet" size="icon" />} aria-label={closeLabel}>
              <X size={16} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type ConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  keep: string
  confirm: string
  onConfirm: () => void
  busy?: boolean
  error?: string | undefined
}

/** Asks before something that cannot be undone; keeping things as they are is the default. */
export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  keep,
  confirm,
  onConfirm,
  busy,
  error,
}: ConfirmProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP} />
        <AlertDialog.Popup className={POPUP}>
          <AlertDialog.Title className="m-0 text-[17px] font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-muted">{body}</AlertDialog.Description>
          {error ? <p className="m-0 text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="quiet" />}>{keep}</AlertDialog.Close>
            <Button variant="danger" onClick={onConfirm} disabled={busy}>
              {confirm}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
