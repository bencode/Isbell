// The machines of the space on a phone: how many are online in the bar, and a sheet from the bottom
// that shows one at a time, so that only that one's load is read.

import { Dialog } from '@base-ui/react/dialog'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../core/i18n'
import { MachineFacts } from '../../features/machine/machine-facts'
import type { MachineEntry } from '../../model/space'

function MachineTab({ entry, active, onPick }: { entry: MachineEntry; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={`flex h-11 max-w-[70%] flex-none cursor-pointer items-center gap-2 rounded-[10px] border border-line px-3 ${active ? 'bg-selected text-text' : 'bg-transparent text-muted'}`}
    >
      <span
        aria-hidden
        className={`size-2 flex-none rounded-full ${entry.online ? 'bg-ok' : 'shadow-[inset_0_0_0_1.5px_var(--faint)]'}`}
      />
      <span className="truncate text-sm font-medium">{entry.state.machine.name}</span>
    </button>
  )
}

/** Mounted with the sheet, so each opening starts on the first machine online. */
function MachineView({ machines }: { machines: MachineEntry[] }) {
  const first = machines.find(m => m.online) ?? machines[0]
  const [pickedId, setPickedId] = useState(first?.state.machine.id)
  const current = machines.find(m => m.state.machine.id === pickedId) ?? first
  return (
    <>
      {machines.length > 1 ? (
        // All in sight up to three rows; past that a part of the fourth shows there are more to scroll to.
        <div className="flex max-h-44 flex-none flex-wrap gap-1.5 overflow-y-auto px-2.5 pb-3">
          {machines.map(entry => (
            <MachineTab
              key={entry.state.machine.id}
              entry={entry}
              active={entry === current}
              onPick={() => setPickedId(entry.state.machine.id)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto border-t border-line px-2.5 pt-3.5 pb-4 text-[13.5px]">
        {/* Keyed, so that one machine's last reading is not shown as another's. */}
        {current ? <MachineFacts key={current.state.machine.id} entry={current} /> : null}
      </div>
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
