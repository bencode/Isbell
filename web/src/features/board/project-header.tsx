// The bar atop a project's views, the same on each so moving between them keeps it still: the
// project and where it is (under the page's tab, while tabs are open), the open tabs, whether it is
// offline, a way to start a task there, and its views. On all agents, the title and the tabs; what
// the space holds is in the sidebar and on the lanes.

import { Plus } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import type { Project } from '../../model/projects'
import { ProjectTabs } from './project-tabs'

const BAR = 'flex h-[52px] flex-none items-center gap-2.5 border-b border-line pr-3 pl-5'
const TITLE = 'm-0 flex-none text-[15px] font-semibold'

/** `tabs`: the open tabs, between what the bar says and its buttons. `pageTab`: the page as the
 * first of them, in place of its title (and where it is), while any are open. `onNew`: opens New. */
type Bar = { tabs: ReactNode; pageTab?: ReactNode; onNew: () => void }

/** `views`: which view this is, and where Agents leads; see `ProjectTabs`. */
export function ProjectHeader({
  project,
  tabs,
  pageTab,
  onNew,
  ...views
}: { project: Project } & Bar & Omit<ComponentProps<typeof ProjectTabs>, 'project'>) {
  const t = useI18n()
  const offline = project.online ? null : (
    <span className="flex-none rounded-full border border-line px-2 text-xs text-muted">
      {t('side.offline')}
    </span>
  )
  return (
    <header className={BAR}>
      {/* While tabs are open nothing stands between them: whether it is offline goes after them. */}
      {pageTab ?? (
        <>
          <h1 className={TITLE}>{project.name}</h1>
          <span className="min-w-0 shrink-[4] truncate font-mono text-xs text-faint">{project.display}</span>
          {offline}
        </>
      )}
      {tabs}
      {pageTab ? offline : null}
      <NewTask onNew={onNew} />
      <ProjectTabs project={project} {...views} />
    </header>
  )
}

export function AllHeader({ tabs, pageTab, onNew }: Bar) {
  const t = useI18n()
  return (
    <header className={BAR}>
      {pageTab ?? <h1 className={TITLE}>{t('all.title')}</h1>}
      {tabs}
      <NewTask onNew={onNew} />
    </header>
  )
}

function NewTask({ onNew }: { onNew: () => void }) {
  const t = useI18n()
  return (
    <Button size="small" onClick={onNew}>
      <Plus size={14} />
      {t('project.newTask')}
    </Button>
  )
}
