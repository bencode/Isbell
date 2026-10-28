// What a file tab shows: the file read as in the project's files, its links leading there, and its
// scroll kept for the tab rather than for the page beneath.

import { useCallback } from 'react'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { projectsSettled } from '../../model/space'
import { type FileTab, tabKey } from '../../model/tabs'
import { projectFilesHref } from '../../utils/hrefs'
import { ScrollScope } from '../files/file-page'
import { Preview } from '../files/preview'

export function FileTabPane({ tab }: { tab: FileTab }) {
  const t = useI18n()
  const view = useSpaceView()
  const project = useProjects().find(p => p.key === tab.project)
  const hrefOf = useCallback((to: string) => projectFilesHref(tab.project, to), [tab.project])
  if (!project)
    return <p className="m-6 text-muted">{projectsSettled(view) ? t('tabs.gone') : t('board.loading')}</p>
  return (
    <ScrollScope value={`tab:${tabKey(tab.project, tab.rel)}`}>
      <div className="flex h-full">
        <Preview mid={project.mid} project={project} rel={tab.rel} hrefOf={hrefOf} />
      </div>
    </ScrollScope>
  )
}
