// The tabs in the bar atop every page: first the page itself, then each tab opened over it with
// where it is from, the preview in italics until pinned (with the pin, or by double-clicking it),
// and a way to close it. Each leads to its address.

import { Pin, X } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { useTabActions } from '../../core/tabs'
import type { TabEntry } from '../../model/tabs'
import { kindOf } from './kinds'

const TAB =
  'group relative inline-flex h-[30px] items-center gap-1.5 rounded-md border pr-1.5 pl-2.5 text-[12.5px]'
const SHOWN = 'index-card border-line bg-raised text-text'
const HIDDEN = 'border-transparent text-muted hover:bg-raised-2'
const LINK =
  'flex h-full min-w-0 flex-1 items-center gap-1.5 text-inherit no-underline focus-visible:outline-2 focus-visible:outline-accent'
const ICON =
  'inline-flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-faint hover:bg-line hover:text-text focus-visible:outline-2 focus-visible:outline-accent'

/** The page beneath the tabs, as the first of them: never closed, and back to it on a click. `hint`:
 * what the page's title said beside it, such as where the project is. */
export function PageTab({
  title,
  hint,
  shown,
}: {
  title: string
  hint?: string | undefined
  shown: boolean
}) {
  const { href } = useTabActions()
  return (
    <Link
      to={href(null)}
      title={hint}
      aria-current={shown ? 'page' : undefined}
      className={`${TAB} flex-none pr-2.5 text-[13.5px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-accent ${shown ? SHOWN : HIDDEN}`}
    >
      {title}
    </Link>
  )
}

export function TabBar({ open, active }: { open: TabEntry[]; active: string | null }) {
  const t = useI18n()
  return (
    <nav
      aria-label={t('tabs.label')}
      className="flex min-w-0 flex-[1_1_auto] items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {open.map(tab => (
        <Tab key={tab.id} tab={tab} shown={active === tab.id} />
      ))}
    </nav>
  )
}

function Tab({ tab, shown }: { tab: TabEntry; shown: boolean }) {
  const t = useI18n()
  const projects = useProjects()
  const { href, pin, close } = useTabActions()
  const found = kindOf(tab.id)
  if (!found) return null
  const { name, where, full } = found.kind.label(found.params, projects)
  return (
    <div className={`${TAB} max-w-52 min-w-24 flex-[0_1_auto] ${shown ? SHOWN : HIDDEN}`} title={full}>
      <Link
        to={href(tab.id)}
        aria-current={shown ? 'page' : undefined}
        onDoubleClick={() => pin(tab.id)}
        className={LINK}
      >
        <found.kind.Icon size={14} className="flex-none" />
        {/* Where it is from gives way first; the name is cut only once that is gone. */}
        <span className="flex min-w-0 flex-[0_1_auto] items-center gap-1.5">
          <span className={`max-w-full flex-none truncate font-medium ${tab.pinned ? '' : 'pr-0.5 italic'}`}>
            {name}
          </span>
          <span className="min-w-0 flex-[0_1_auto] truncate text-[11.5px] text-faint">{where}</span>
        </span>
      </Link>
      {tab.pinned ? null : (
        <button
          type="button"
          onClick={() => pin(tab.id)}
          aria-label={t('tabs.pin')}
          title={t('tabs.pin')}
          className={`${ICON} ${shown ? '' : 'hidden group-hover:inline-flex'}`}
        >
          <Pin size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={() => close(tab.id, shown)}
        aria-label={t('tabs.close', { name })}
        title={t('tabs.close', { name })}
        className={ICON}
      >
        <X size={12} />
      </button>
    </div>
  )
}
