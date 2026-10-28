// The open file tabs in the bar atop every page: each file with its project's name, the preview in
// italics until pinned (with the pin, or by double-clicking it), and a way to close it.

import { FileText, Pin, X } from 'lucide-react'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { closeTab, pinTab, showTab, useTabs } from '../../core/tabs'
import { nameOf } from '../../model/files/paths'
import { type FileTab, tabKey } from '../../model/tabs'

const TAB =
  'group relative inline-flex h-[30px] max-w-52 min-w-24 flex-[0_1_auto] items-center gap-1.5 rounded-md border pr-1.5 pl-2.5 text-[12.5px]'
const ICON =
  'inline-flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-faint hover:bg-line hover:text-text focus-visible:outline-2 focus-visible:outline-accent'

export function TabBar() {
  const t = useI18n()
  const { open, active } = useTabs()
  return (
    <nav
      aria-label={t('tabs.label')}
      className="flex min-w-0 flex-[1_1_auto] items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {open.map(tab => {
        const key = tabKey(tab.project, tab.rel)
        return <Tab key={key} tab={tab} tabId={key} shown={active === key} />
      })}
    </nav>
  )
}

function Tab({ tab, tabId, shown }: { tab: FileTab; tabId: string; shown: boolean }) {
  const t = useI18n()
  const project = useProjects().find(p => p.key === tab.project)
  // A project no longer running is named from its key, `mid:path`.
  const where = project?.display ?? tab.project.slice(tab.project.indexOf(':') + 1)
  const name = nameOf(tab.rel)
  return (
    <div
      className={`${TAB} ${shown ? 'index-card border-line bg-raised text-text' : 'border-transparent text-muted hover:bg-raised-2'}`}
      title={`${where}/${tab.rel}`}
    >
      <button
        type="button"
        aria-current={shown ? 'page' : undefined}
        onClick={() => showTab(tabId)}
        onDoubleClick={() => pinTab(tabId)}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-inherit focus-visible:outline-2 focus-visible:outline-accent"
      >
        <FileText size={14} className="flex-none" />
        <span className={`min-w-[3.5em] flex-[0_1_auto] truncate font-medium ${tab.pinned ? '' : 'italic'}`}>
          {name}
        </span>
        <span className="min-w-0 flex-[0_6_auto] truncate text-[11.5px] text-faint">
          {project?.name ?? nameOf(where)}
        </span>
      </button>
      {tab.pinned ? null : (
        <button
          type="button"
          onClick={() => pinTab(tabId)}
          aria-label={t('tabs.pin')}
          title={t('tabs.pin')}
          className={`${ICON} ${shown ? '' : 'hidden group-hover:inline-flex'}`}
        >
          <Pin size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={() => closeTab(tabId)}
        aria-label={t('tabs.close', { name })}
        title={t('tabs.close', { name })}
        className={ICON}
      >
        <X size={12} />
      </button>
    </div>
  )
}
