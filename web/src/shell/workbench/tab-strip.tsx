// The tabs along the top of the workspace, on the side's color: the one shown is cut from the page
// below it. A preview's pin and every close come up on hover; a pinned tab shows its pin, at rest in
// the place of the close. A double click pins or unpins.

import { Pin, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { IconButton } from '../../components/icon-button'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { kindOf } from '../../features/tabs/kinds'
import type { TabEntry } from '../../model/tabs'

const SMALL = { size: 13, strokeWidth: 1.5, absoluteStrokeWidth: true }
const TAB = 'group flex h-full min-w-24 flex-[0_1_196px] items-center gap-1.5 pr-1.5 pl-[11px] text-[13px]'
const SHOWN = 'bg-bg font-medium text-text shadow-[inset_-1px_0_var(--line)]'
const HIDDEN =
  'text-muted shadow-[inset_-1px_0_var(--line),inset_0_-1px_var(--line)] transition-colors duration-75 hover:bg-hover hover:text-text'
const ON_HOVER = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
// Past the close's place, until the tab is pointed at or shown.
const AT_REST =
  'translate-x-[26px] transition-transform duration-75 group-hover:translate-x-0 group-focus-within:translate-x-0'

function Tab({ tab, shown, edged }: { tab: TabEntry; shown: boolean; edged: boolean }) {
  const t = useI18n()
  const projects = useProjects()
  const { href, togglePin, close } = useTabActions()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shown) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [shown])
  const found = kindOf(tab.id)
  if (!found) return null
  const { name, full } = found.kind.label(found.params, projects)
  const quiet = shown ? '' : ON_HOVER
  return (
    <div
      ref={ref}
      className={`${TAB} ${shown ? SHOWN : HIDDEN} ${edged ? 'border-l border-line' : ''}`}
      title={full}
    >
      <Link
        to={href(tab.id)}
        aria-current={shown ? 'page' : undefined}
        onDoubleClick={() => togglePin(tab.id)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-inherit no-underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <found.kind.Icon {...SMALL} className="flex-none text-faint" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </Link>
      <IconButton
        label={t(tab.pinned ? 'workbench.unpinTab' : 'workbench.pinTab', { name })}
        size="tiny"
        aria-pressed={tab.pinned}
        onClick={() => togglePin(tab.id)}
        className={tab.pinned ? (shown ? '' : AT_REST) : quiet}
      >
        <Pin {...SMALL} fill={tab.pinned ? 'currentColor' : 'none'} />
      </IconButton>
      <IconButton
        label={t('tabs.close', { name })}
        size="tiny"
        onClick={() => close(tab.id, shown)}
        className={quiet}
      >
        <X {...SMALL} />
      </IconButton>
    </div>
  )
}

/** `edged`: nothing stands left of the first tab to draw its edge. */
export function TabStrip({ edged }: { edged: boolean }) {
  const t = useI18n()
  const { open, active, recent } = useTabRoute()
  const shown = active ?? recent
  return (
    <nav
      aria-label={t('tabs.label')}
      className="-mr-px flex h-full min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
    >
      {open.map((tab, i) => (
        <Tab key={tab.id} tab={tab} shown={tab.id === shown} edged={edged && i === 0} />
      ))}
    </nav>
  )
}
