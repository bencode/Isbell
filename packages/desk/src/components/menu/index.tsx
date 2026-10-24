import { Menu } from '@base-ui/react/menu'
import type { ReactElement, ReactNode } from 'react'

export type MenuItem = { label: ReactNode; onClick: () => void; danger?: boolean }

export function DropdownMenu({ trigger, items }: { trigger: ReactElement; items: MenuItem[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup className="w-56 rounded-xl border border-line bg-raised-2 p-1.5 shadow-2xl outline-none">
            {items.map((item, i) => (
              <Menu.Item
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for the menu's life.
                key={i}
                onClick={item.onClick}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 outline-none select-none data-highlighted:bg-raised ${item.danger ? 'text-danger' : 'text-text'}`}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
