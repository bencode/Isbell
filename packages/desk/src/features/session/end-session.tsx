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
  path: string
  onEnded: () => void
}

/** Ending stops the agent and closes its pane; what it changed on disk stays. */
export function EndSession({ open, onOpenChange, mid, paneId, name, machine, path, onEnded }: Props) {
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
      title={t('end.title')}
      body={t('end.body', { name, machine, path })}
      keep={t('end.keep')}
      confirm={t('end.confirm')}
      onConfirm={() => void end()}
      busy={busy}
      error={error}
    />
  )
}
