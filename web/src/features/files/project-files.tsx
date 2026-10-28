// A project's files: the tree and the file read. An address ending in '/' is a directory, opened
// in the tree with nothing read yet.

import { useCallback } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { projectFilesHref } from '../../utils/hrefs'
import { ProjectHeader } from '../board/project-header'
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
  // Stable, so a document's links are not rendered again for it.
  const hrefOf = useCallback((to: string) => projectFilesHref(project.key, to), [project.key])
  const isDir = rel.endsWith('/')
  return (
    <div className="flex h-full flex-col">
      <ProjectHeader project={project} current="files" />
      <FilesSplit
        mid={project.mid}
        project={project}
        dir={isDir ? rel.slice(0, -1) : ''}
        rel={isDir ? '' : rel}
        hrefOf={hrefOf}
      />
    </div>
  )
}
