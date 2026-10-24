import { closePane } from '@isbell/core'
import { useState } from 'react'
import { Confirm } from '../../components/dialog'
import { errorText, useT } from '../../core/i18n'
import { useSpace } from '../../core/space'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mid: string
  paneId: string
  name: string
  machine: string
  onEnded: () => void
}

/** Ending closes the pane and whatever runs in it; leaving the page only detaches. */
export function EndTerminal({ open, onOpenChange, mid, paneId, name, machine, onEnded }: Props) {
  const t = useT()
  const space = useSpace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const end = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await closePane(space.call, mid, paneId)
      onEnded()
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={t('terminal.endTitle')}
      body={t('terminal.endBody', { name, machine })}
      keep={t('end.keep')}
      confirm={t('terminal.endConfirm')}
      onConfirm={() => void end()}
      busy={busy}
      error={error}
    />
  )
}
