// The machines of the space on a phone: how many are online in the bar, and a sheet from the bottom
// that shows one at a time, so that only that one's load is read, and lists them all to pick another.

import { Dialog } from '@base-ui/react/dialog'
import { Check, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../core/i18n'
import { MachineFacts } from '../../features/machine/machine-facts'
import type { MachineEntry } from '../../model/space'

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-2 flex-none rounded-full ${online ? 'bg-ok' : 'shadow-[inset_0_0_0_1.5px_var(--faint)]'}`}
    />
  )
}

function MachineChoices({
  machines,
  current,
  onPick,
}: {
  machines: MachineEntry[]
  current: MachineEntry | undefined
  onPick: (id: string) => void
}) {
  const t = useI18n()
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {machines.map(entry => (
        <button
          key={entry.state.machine.id}
          type="button"
          onClick={() => onPick(entry.state.machine.id)}
          className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-line bg-transparent px-2.5 text-left text-text"
        >
          <OnlineDot online={entry.online} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{entry.state.machine.name}</span>
          {entry.online ? null : (
            <span className="flex-none text-[12.5px] text-faint">{t('side.offline')}</span>
          )}
          <span className="w-[18px] flex-none text-accent">
            {entry === current ? <Check size={18} /> : null}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Mounted with the sheet, so each opening starts on the first machine online. */
function MachineView({ machines }: { machines: MachineEntry[] }) {
  const first = machines.find(m => m.online) ?? machines[0]
  const [pickedId, setPickedId] = useState(first?.state.machine.id)
  const [choosing, setChoosing] = useState(false)
  const current = machines.find(m => m.state.machine.id === pickedId) ?? first
  const pick = (id: string) => {
    setPickedId(id)
    setChoosing(false)
  }
  return (
    <>
      {machines.length > 1 && current ? (
        <div className="flex flex-none pb-2">
          <button
            type="button"
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
            className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-raised px-[9px] text-text"
          >
            <OnlineDot online={current.online} />
            <b className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
              {current.state.machine.name}
            </b>
            <ChevronsUpDown size={15} className="flex-none text-muted" />
          </button>
        </div>
      ) : null}
      {choosing ? (
        <MachineChoices machines={machines} current={current} onPick={pick} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto border-t border-line px-2.5 pt-3.5 pb-4 text-[13.5px]">
          {/* Keyed, so that one machine's last reading is not shown as another's. */}
          {current ? <MachineFacts key={current.state.machine.id} entry={current} /> : null}
        </div>
      )}
    </>
  )
}

export function MachinesSheet({ machines }: { machines: MachineEntry[] }) {
  const t = useI18n()
  return (
    <Dialog.Root>
      <Dialog.Trigger
        disabled={!machines.length}
        className="flex h-11 min-w-0 cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[12.5px] text-faint"
      >
        <span className="truncate">{t('mobile.online', { n: machines.filter(m => m.online).length })}</span>
        <ChevronDown size={13} className="flex-none" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        {/* Of a set height, so the sheet stays put as a machine is picked and its load arrives. */}
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col rounded-t-2xl bg-raised px-2 pb-[env(safe-area-inset-bottom)] outline-none">
          <div className="mx-auto mt-2 mb-1 h-1 w-9 flex-none rounded-sm bg-line-strong" />
          <Dialog.Title className="m-0 flex-none px-2.5 py-2 text-[15px] font-semibold">
            {t('machine.info')}
          </Dialog.Title>
          <MachineView machines={machines} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
