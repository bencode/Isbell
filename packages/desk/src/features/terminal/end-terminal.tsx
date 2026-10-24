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
  /** An agent's pane: ending it ends the session, and is confirmed as the session page does. */
  agent: boolean
  onEnded: () => void
}

/** Ending closes the pane and whatever runs in it; leaving the page only detaches. */
export function EndTerminal({ open, onOpenChange, mid, paneId, name, machine, path, agent, onEnded }: Props) {
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
      title={agent ? t('end.title') : t('terminal.endTitle')}
      body={agent ? t('end.body', { name, machine, path }) : t('terminal.endBody', { name, machine })}
      keep={t('end.keep')}
      confirm={agent ? t('end.confirm') : t('terminal.endConfirm')}
      onConfirm={() => void end()}
      busy={busy}
      error={error}
    />
  )
}
