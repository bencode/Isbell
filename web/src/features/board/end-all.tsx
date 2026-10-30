// Ends a group of agents or shells at once, asked once: those still for a day, or the plain shells
// left open, are the ones most likely forgotten.

import { useState } from 'react'
import { Confirm } from '../../components/dialog'
import { endNow } from '../../core/ending'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'

/** `title` and `body`: what the asking says, naming what ends. */
export function EndAll({
  panes,
  title,
  body,
}: {
  panes: { mid: string; paneId: string }[]
  title: string
  body: string
}) {
  const t = useI18n()
  const { call } = useSpace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(0)
  const endAll = async () => {
    setBusy(true)
    setFailed(0)
    // Asked already, so each closes at once; one that fails says so on its row as well.
    const ended = await Promise.all(panes.map(({ mid, paneId }) => endNow(call, mid, paneId)))
    setBusy(false)
    const left = ended.filter(ok => !ok).length
    if (left) setFailed(left)
    else setOpen(false)
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(0)
          setOpen(true)
        }}
        className="h-6 flex-none cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-[11.5px] text-faint hover:bg-raised-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t('lane.endStale')}
      </button>
      <Confirm
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        keep={t('end.keep')}
        confirm={t('end.allConfirm')}
        onConfirm={() => void endAll()}
        busy={busy}
        error={failed ? t('end.allFailed', { n: failed }) : undefined}
      />
    </>
  )
}
