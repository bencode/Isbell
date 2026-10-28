// The bar atop a project's views, the same on each so moving between them keeps it still: the
// project, where it is, the open tabs, a way to start a task there, and its views. On all
// agents, what the space holds.

import { Plus } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import { ProjectTabs } from './project-tabs'

const BAR = 'flex h-[52px] flex-none items-center gap-2.5 border-b border-line pr-3 pl-5'
const TITLE = 'm-0 flex-none text-[15px] font-semibold'

/** `tabs`: the open tabs, between what the bar says and its buttons. `pageTab`: the page as the
 * first of them, in place of its title, while any are open. `onNew`: opens New. */
type Bar = { tabs: ReactNode; pageTab?: ReactNode; onNew: () => void }

/** `views`: which view this is, and where Agents leads; see `ProjectTabs`. */
export function ProjectHeader({
  project,
  tabs,
  pageTab,
  onNew,
  ...views
}: { project: Project } & Bar & Omit<ComponentProps<typeof ProjectTabs>, 'projectKey'>) {
  const t = useI18n()
  return (
    <header className={BAR}>
      {pageTab ?? <h1 className={TITLE}>{project.name}</h1>}
      <span className="min-w-0 shrink-[4] truncate font-mono text-xs text-faint">{project.display}</span>
      <span className="flex-none rounded-md border border-line px-1.5 text-xs text-muted">
        {project.machine}
      </span>
      {project.online ? null : (
        <span className="flex-none rounded-full border border-line px-2 text-xs text-muted">
          {t('side.offline')}
        </span>
      )}
      {tabs}
      <NewTask onNew={onNew} />
      <ProjectTabs projectKey={project.key} {...views} />
    </header>
  )
}

export function AllHeader({ tabs, pageTab, onNew }: Bar) {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const online = view.machines.filter(m => m.online).length
  const agents = projects.reduce((n, p) => n + p.sessions.length, 0)
  return (
    <header className={BAR}>
      {pageTab ?? <h1 className={TITLE}>{t('all.title')}</h1>}
      <span className="min-w-0 shrink-[4] truncate text-[12.5px] text-faint">
        {t('all.summary', { projects: projects.length, machines: view.machines.length, online, agents })}
      </span>
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
