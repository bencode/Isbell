// The clock on a session's bar: its scheduled message, set up in a popover. Lit while one is running.

import { Popover } from '@base-ui/react/popover'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import { IconButton, SMALL_ICON } from '../../../components/icon-button'
import { useI18n } from '../../../core/i18n'
import { refreshLoops, useLoops } from '../../../core/loops'
import { useSpace } from '../../../core/space'
import { loopOf } from '../../../model/loops'
import { LoopForm } from './loop-form'

type Props = { mid: string; paneId: string; project: string }

export function LoopButton({ mid, paneId, project }: Props) {
  const t = useI18n()
  const { openStream } = useSpace()
  const { able, loops, runs } = useLoops(mid)
  const [open, setOpen] = useState(false)
  if (!able) return null
  const loop = loopOf(loops, paneId)
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    refreshLoops(openStream, mid).catch((err: unknown) => {
      console.error('could not read the loops', mid, err)
    })
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        render={
          <IconButton label={t('loop.title')} size="small" className={loop?.enabled ? 'text-accent!' : ''}>
            <Clock {...SMALL_ICON} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50 outline-none">
          <Popover.Popup className="flex max-h-[70vh] w-[400px] flex-col gap-3.5 overflow-auto rounded-[10px] border border-line-strong bg-raised p-4 text-[13px] text-text shadow-[0_8px_28px_rgb(0_0_0/0.2)] outline-none">
            <LoopForm
              key={loop?.id ?? 'new'}
              mid={mid}
              paneId={paneId}
              project={project}
              loop={loop}
              run={loop && runs[loop.id]}
              onDone={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
