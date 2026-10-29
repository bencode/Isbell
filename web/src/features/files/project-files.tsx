// A project's files: the tree and the file read, under the project's own directory or another of
// its worktrees, as the address's key names. An address ending in '/' is a directory, opened in the
// tree with nothing read yet.

import { useCallback } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useRootOf } from '../../core/worktrees'
import type { FilesRoot } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import { projectFilesHref } from '../../utils/hrefs'
import { FilesSplit } from './files-split'

export function ProjectFiles() {
  const t = useI18n()
  const params = useParams()
  const { project, roots, root, settled } = useRootOf(params.key ?? '')

  // Until the projects and worktrees settle, one not found may yet appear.
  if ((!project || !root) && !settled) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!project)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  // Keyed, so the tree starts over for each project, but not for each of its worktrees.
  return <Browse key={project.key} project={project} roots={roots} root={root} rel={params['*'] ?? ''} />
}

type BrowseProps = { project: Project; roots: FilesRoot[]; root: FilesRoot | undefined; rel: string }

function Browse({ project, roots, root, rel }: BrowseProps) {
  // Stable, so a document's links are not rendered again for it.
  const key = root?.key ?? project.key
  const hrefOf = useCallback((to: string) => projectFilesHref(key, to), [key])
  const isDir = rel.endsWith('/')
  return (
    <div className="flex h-full flex-col">
      <FilesSplit
        mid={project.mid}
        project={project}
        roots={roots}
        root={root}
        dir={isDir ? rel.slice(0, -1) : ''}
        rel={isDir ? '' : rel}
        hrefOf={hrefOf}
      />
    </div>
  )
}
