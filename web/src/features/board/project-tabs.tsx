// A project's views: its agents on their lanes, the sessions recorded in it, and its files.

import { FolderOpen, History, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { useFilesAt } from '../../core/worktrees'
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
  const at = useFilesAt(project.key)
  const filesHref = at ? projectFilesHref(at.root, at.rel) : projectFilesHref(project.key)
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
