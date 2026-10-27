// A project's views: its overview (the agents on their lanes) and its files.

import { FolderOpen, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { projectFilesHref, projectHref } from '../../utils/hrefs'

export function ProjectTabs({ projectKey, current }: { projectKey: string; current: 'overview' | 'files' }) {
  const t = useI18n()
  const views = [
    {
      key: 'overview',
      href: projectHref(projectKey),
      icon: <LayoutGrid size={15} />,
      label: t('project.overview'),
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
