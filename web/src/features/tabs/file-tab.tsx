// What a file tab shows: the file read as in the project's files, its links leading there, and its
// scroll kept for the tab rather than for the page beneath.

import { useCallback } from 'react'
import type { Params } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { projectsSettled } from '../../model/space'
import { projectFilesHref } from '../../utils/hrefs'
import { ScrollScope } from '../files/file-page'
import { Preview } from '../files/preview'

/** `params`: the project's key and the file's path in it, from the tab's id. */
export function FileTabPane({ id, params: { key = '', '*': rel = '' } }: { id: string; params: Params }) {
  const t = useI18n()
  const view = useSpaceView()
  const project = useProjects().find(p => p.key === key)
  const hrefOf = useCallback((to: string) => projectFilesHref(key, to), [key])
  if (!project)
    return <p className="m-6 text-muted">{projectsSettled(view) ? t('tabs.gone') : t('board.loading')}</p>
  return (
    <ScrollScope value={`tab:${id}`}>
      <div className="flex h-full">
        <Preview mid={project.mid} project={project} rel={rel} hrefOf={hrefOf} />
      </div>
    </ScrollScope>
  )
}
