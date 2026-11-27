// The tabs at the foot of a phone's first pages. Going from one to another stays out of the history,
// as an app's tabs do, and comes back to where each was left (page-place.ts). The inbox's tab counts
// the messages waiting on the user.

import { Bot, Folder, Inbox, ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useMessageFeed } from '../../core/books'
import { useI18n } from '../../core/i18n'
import { asksYou } from '../../model/messages'

/** What a page under the tabs leaves free at its foot. */
export const UNDER_TABS = 'pb-[calc(env(safe-area-inset-bottom)+72px)]'

function Tab({
  to,
  icon,
  badge = 0,
  children,
}: {
  to: string
  icon: ReactNode
  badge?: number
  children: ReactNode
}) {
  return (
    <NavLink
      to={to}
      end
      replace
      className={({ isActive }) =>
        `flex h-12 flex-col items-center justify-center gap-0.5 text-[10.5px] no-underline ${isActive ? 'font-semibold text-accent' : 'font-medium text-faint'}`
      }
    >
      <span className="relative">
        {icon}
        {badge ? (
          <span className="absolute -top-1 left-[60%] min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </span>
      {children}
    </NavLink>
  )
}

export function TabBar() {
  const t = useI18n()
  const asking = useMessageFeed().filter(p => asksYou(p.message)).length
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-line bg-raised/90 px-2 pt-1 pb-[calc(env(safe-area-inset-bottom)+4px)] backdrop-blur-md">
      <Tab to="/" icon={<Bot size={22} />}>
        {t('workbench.agents')}
      </Tab>
      <Tab to="/tasks" icon={<ListChecks size={22} />}>
        {t('workbench.tasks')}
      </Tab>
      <Tab to="/inbox" icon={<Inbox size={22} />} badge={asking}>
        {t('mobile.inbox')}
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
