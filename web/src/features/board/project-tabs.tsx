// A project's views: its agents on their lanes, and its files.

import { FolderOpen, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { useLocal } from '../../core/prefs'
import { useFilesRoots } from '../../core/worktrees'
import type { Project } from '../../model/projects'
import { projectFilesHref, projectHref } from '../../utils/hrefs'

/** `current`: none on a page that is neither, such as a terminal; `agentsHref`, where Agents leads
 * instead of the project's board. */
export function ProjectTabs({
  project,
  current,
  agentsHref = projectHref(project.key),
}: {
  project: Project
  current?: 'agents' | 'files'
  agentsHref?: string
}) {
  const t = useI18n()
  const filesHref = useFilesHref(project)
  const views = [
    {
      key: 'agents',
      href: agentsHref,
      icon: <LayoutGrid size={15} />,
      label: t('project.agents'),
    },
    {
      key: 'files',
      href: filesHref,
      icon: <FolderOpen size={15} />,
      label: t('project.files'),
    },
  ]
  return <ViewTabs label={t('project.views')} views={views} current={current ?? ''} />
}

/** Where a project's Files leads: back where they were last read, unless that worktree is known to
 * be gone. */
function useFilesHref(project: Project): string {
  const at = useLocal().layout.filesAt[project.key]
  const { roots, settled } = useFilesRoots(project)
  const gone = settled && !roots.some(root => root.key === at?.root)
  return at && !gone ? projectFilesHref(at.root, at.rel) : projectFilesHref(project.key)
}
