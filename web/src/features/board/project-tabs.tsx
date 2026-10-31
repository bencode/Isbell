// A project's views: its agents on their lanes, the sessions recorded in it, and its files.

import { FolderOpen, History, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { useLocal } from '../../core/prefs'
import { useFilesRoots } from '../../core/worktrees'
import type { Project } from '../../model/projects'
import { projectFilesHref, projectHref, projectSessionsHref } from '../../utils/hrefs'

/** `current`: none beneath a tab, where neither is the one shown. */
export function ProjectTabs({
  project,
  current,
}: {
  project: Project
  current?: 'agents' | 'sessions' | 'files'
}) {
  const t = useI18n()
  const filesHref = useFilesHref(project)
  const views = [
    {
      key: 'agents',
      href: projectHref(project.key),
      icon: <LayoutGrid size={15} />,
      label: t('project.agents'),
    },
    {
      key: 'sessions',
      href: projectSessionsHref(project.key),
      icon: <History size={15} />,
      label: t('project.sessions'),
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
