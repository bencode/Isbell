// The bar atop a project's views, the same on each so moving between them keeps it still: the
// project, where it is, a way to start a task there, and its views. On all agents, what the space
// holds.

import { Plus } from 'lucide-react'
import { useOutletContext } from 'react-router'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import type { BoardActions } from './agents-page'
import { ProjectTabs } from './project-tabs'

const BAR = 'flex h-[52px] flex-none items-center gap-2.5 border-b border-line pr-3 pl-5'

export function ProjectHeader({ project, current }: { project: Project; current: 'agents' | 'files' }) {
  const t = useI18n()
  return (
    <header className={BAR}>
      <h1 className="m-0 flex-none text-[15px] font-semibold">{project.name}</h1>
      <span className="min-w-0 truncate font-mono text-xs text-faint">{project.display}</span>
      <span className="flex-none rounded-md border border-line px-1.5 text-xs text-muted">
        {project.machine}
      </span>
      {project.online ? null : (
        <span className="flex-none rounded-full border border-line px-2 text-xs text-muted">
          {t('side.offline')}
        </span>
      )}
      <span className="flex-1" />
      <NewTask />
      <ProjectTabs projectKey={project.key} current={current} />
    </header>
  )
}

export function AllHeader() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const online = view.machines.filter(m => m.online).length
  const agents = projects.reduce((n, p) => n + p.sessions.length, 0)
  return (
    <header className={BAR}>
      <h1 className="m-0 flex-none text-[15px] font-semibold">{t('all.title')}</h1>
      <span className="min-w-0 truncate text-[12.5px] text-faint">
        {t('all.summary', { projects: projects.length, machines: view.machines.length, online, agents })}
      </span>
      <span className="flex-1" />
      <NewTask />
    </header>
  )
}

/** Opens New on the project the page is in, if any. */
function NewTask() {
  const t = useI18n()
  const { openNew } = useOutletContext<BoardActions>()
  return (
    <Button size="small" onClick={openNew}>
      <Plus size={14} />
      {t('project.newTask')}
    </Button>
  )
}
