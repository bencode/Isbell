// The ⋯ at the top right of each tab on a phone: what is wanted now and then, past sessions, the
// machines and the settings, at a finger's size.

import { Menu } from '@base-ui/react/menu'
import { History, MoreHorizontal, Server, Settings2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import { type Overlay, Overlays } from '../../features/settings/settings-dialog'
import { TAP } from './bar'
import { MachinesSheet } from './machines-sheet'

function Item({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex h-11 cursor-pointer items-center gap-3 rounded-[9px] px-3 text-[15px] text-text outline-none select-none data-highlighted:bg-press"
    >
      <span className="flex-none text-faint">{icon}</span>
      {children}
    </Menu.Item>
  )
}

export function MoreMenu() {
  const t = useI18n()
  const navigate = useNavigate()
  const { machines } = useSpaceView()
  const [machinesOpen, setMachinesOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const online = machines.filter(m => m.online).length
  return (
    <>
      <Menu.Root>
        <Menu.Trigger aria-label={t('mobile.more')} className={TAP}>
          <MoreHorizontal size={21} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end" className="z-50 outline-none">
            <Menu.Popup className="w-56 rounded-[14px] border border-line bg-raised p-1.5 shadow-[0_16px_36px_-8px_rgb(0_0_0/0.3)] outline-none">
              <Item icon={<History size={18} />} onClick={() => void navigate('/sessions')}>
                {t('workbench.sessions')}
              </Item>
              <Item icon={<Server size={18} />} onClick={() => setMachinesOpen(true)}>
                <span className="flex-1">{t('mobile.machines')}</span>
                <span className="text-[12.5px] text-faint">{t('mobile.online', { n: online })}</span>
              </Item>
              <Item icon={<Settings2 size={18} />} onClick={() => setOverlay('settings')}>
                {t('side.settings')}
              </Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <MachinesSheet machines={machines} open={machinesOpen} onOpenChange={setMachinesOpen} />
      <Overlays overlay={overlay} setOverlay={setOverlay} />
    </>
  )
}
