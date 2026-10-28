// A project's views: its agents on their lanes, and its files.

import { FolderOpen, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { projectFilesHref, projectHref } from '../../utils/hrefs'

export function ProjectTabs({ projectKey, current }: { projectKey: string; current: 'agents' | 'files' }) {
  const t = useI18n()
  const views = [
    {
      key: 'agents',
      href: projectHref(projectKey),
      icon: <LayoutGrid size={15} />,
      label: t('project.agents'),
    },
    {
      key: 'files',
      href: projectFilesHref(projectKey),
      icon: <FolderOpen size={15} />,
      label: t('project.files'),
    },
  ]
  return <ViewTabs label={t('project.views')} views={views} current={current} />
}
