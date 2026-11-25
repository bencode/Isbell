// The bar at the right edge: an icon for each view of the right column, which opens or closes it.
// With none open, the column folds away and the bar is what is left of it, still counting what asks
// for you.

import { Bot, ListChecks, type LucideIcon } from 'lucide-react'
import { ICON, IconButton } from '../../components/icon-button'
import { type Key, useI18n } from '../../core/i18n'
import { type RightView, useLocal } from '../../core/prefs'
import { useProjects } from '../../core/space'
import { lanes } from '../../model/projects'

const VIEWS: { view: RightView; Icon: LucideIcon; label: Key }[] = [
  { view: 'agents', Icon: Bot, label: 'workbench.agents' },
  { view: 'tasks', Icon: ListChecks, label: 'workbench.tasks' },
]

/** `onToggle` opens or closes a view. */
export function RightBar({ onToggle }: { onToggle: (view: RightView) => void }) {
  const t = useI18n()
  const open = useLocal().layout.rightViews
  const asking = lanes(useProjects()).asking.length
  const counts: Record<RightView, number> = { agents: asking, tasks: 0 }
  return (
    <nav
      aria-label={t('workbench.rightBar')}
      className="flex w-11 flex-none flex-col items-center gap-1 border-l border-line bg-side pt-[7px]"
    >
      {VIEWS.map(({ view, Icon, label }) => {
        const on = open.includes(view)
        const count = counts[view]
        return (
          <span key={view} className="relative">
            <IconButton
              label={count ? t('workbench.asking', { name: t(label), n: count }) : t(label)}
              side="left"
              aria-pressed={on}
              onClick={() => onToggle(view)}
              className={
                on
                  ? "relative bg-selected text-text before:absolute before:inset-y-[5px] before:-right-[6px] before:w-0.5 before:rounded-full before:bg-accent before:content-['']"
                  : ''
              }
            >
              <Icon {...ICON} />
            </IconButton>
            {count ? (
              <span className="pointer-events-none absolute -top-1 -right-1 h-[15px] min-w-[15px] rounded-full bg-warn px-[3px] text-center font-mono text-[9.5px] leading-[15px] font-bold text-raised shadow-[0_0_0_2px_var(--side)]">
                {count}
              </span>
            ) : null}
          </span>
        )
      })}
    </nav>
  )
}
