// The tabs at the foot of a phone's first pages. Going from one to another stays out of the history,
// as an app's tabs do, and comes back to where each was left (page-place.ts).

import { Bot, Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useI18n } from '../../core/i18n'

/** What a page under the tabs leaves free at its foot. */
export const UNDER_TABS = 'pb-[calc(env(safe-area-inset-bottom)+72px)]'

function Tab({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      replace
      className={({ isActive }) =>
        `flex h-12 flex-col items-center justify-center gap-0.5 text-[10.5px] no-underline ${isActive ? 'font-semibold text-accent' : 'font-medium text-faint'}`
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

export function TabBar() {
  const t = useI18n()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-2 border-t border-line bg-raised/90 px-2 pt-1 pb-[calc(env(safe-area-inset-bottom)+4px)] backdrop-blur-md">
      <Tab to="/" icon={<Bot size={22} />}>
        {t('workbench.agents')}
      </Tab>
      <Tab to="/files" icon={<Folder size={22} />}>
        {t('workbench.files')}
      </Tab>
    </nav>
  )
}

/** A tab's name, large at the start of its bar. */
export function TabTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 min-w-0 flex-1 truncate pl-2.5 text-[24px] leading-tight font-bold tracking-tight">
      {children}
    </h1>
  )
}
