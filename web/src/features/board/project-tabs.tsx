// A project's views: its agents on their lanes, and its files.

import { FolderOpen, LayoutGrid } from 'lucide-react'
import { ViewTabs } from '../../components/view-tabs'
import { useI18n } from '../../core/i18n'
import { projectFilesHref, projectHref } from '../../utils/hrefs'

/** `current`: none on a page that is neither, such as a terminal; `agentsHref`, where Agents leads
 * instead of the project's board; `reveal`, see `ViewTabs`. */
export function ProjectTabs({
  projectKey,
  current,
  agentsHref = projectHref(projectKey),
  reveal,
}: {
  projectKey: string
  current?: 'agents' | 'files'
  agentsHref?: string
  reveal?: (() => void) | undefined
}) {
  const t = useI18n()
  const views = [
    {
      key: 'agents',
      href: agentsHref,
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
  return <ViewTabs label={t('project.views')} views={views} current={current ?? ''} reveal={reveal} />
}
