// A project's files, from its page: the same tree and file as a pane's, opened at the root.

import { useCallback } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { projectFilesHref } from '../../utils/hrefs'
import { ProjectTabs } from '../board/project-tabs'
import { FilesSplit } from './files-split'

export function ProjectFiles() {
  const t = useI18n()
  const params = useParams()
  const view = useSpaceView()
  const project = useProjects().find(p => p.key === params.key)

  // Until the projects settle, one not found may yet appear.
  if (!project && !projectsSettled(view)) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!project)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  // Keyed, so the tree starts over for each project.
  return <Browse key={project.key} project={project} rel={params['*'] ?? ''} />
}

function Browse({ project, rel }: { project: Project; rel: string }) {
  const t = useI18n()
  // Stable, so a document's links are not rendered again for it.
  const hrefOf = useCallback((to: string) => projectFilesHref(project.key, to), [project.key])
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line pr-3 pl-5">
        <span className="flex-none font-semibold">{project.name}</span>
        <span className="min-w-0 truncate text-[12.5px] text-faint">
          {project.machine} · {project.display}
        </span>
        {project.online ? null : (
          <span className="rounded-full border border-line px-2 text-xs text-muted">{t('side.offline')}</span>
        )}
        <span className="flex-1" />
        <ProjectTabs projectKey={project.key} current="files" />
      </header>
      <FilesSplit mid={project.mid} project={project} cwd="" rel={rel} hrefOf={hrefOf} />
    </div>
  )
}
