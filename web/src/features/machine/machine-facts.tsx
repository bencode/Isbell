// The machine panel's content: what the machine is and, while it is online on an isbell that can
// say, how loaded it is. Mounted only while the panel is open, so its reads stop with it.

import { InfoFacts } from '../../components/info-panel'
import { useI18n } from '../../core/i18n'
import type { MachineEntry } from '../../model/space'
import { SYSTEM_METHOD } from '../../model/system'
import { machineFacts } from './facts'
import { useSystem } from './use-system'

export function MachineFacts({ entry }: { entry: MachineEntry }) {
  const t = useI18n()
  const able = entry.state.caps.methods.includes(SYSTEM_METHOD)
  const sys = useSystem(entry.state.machine.id, entry.online && able)
  return (
    <>
      <InfoFacts groups={machineFacts(t, entry, sys)} />
      {entry.online && !able ? <p className="m-0 text-muted">{t('machine.old')}</p> : null}
    </>
  )
}
