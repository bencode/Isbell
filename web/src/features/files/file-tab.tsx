// What a file tab shows: the file read, its links leading into the project's files, and its scroll
// kept for the tab.

import { useCallback } from 'react'
import type { Params } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import { useRootOf } from '../../core/worktrees'
import { machineOf } from '../../model/space'
import { projectFilesHref } from '../../utils/hrefs'
import { ScrollScope } from './file-page'
import { filesNote } from './notes'
import { Preview } from './preview'

/** `params`: the key of the root the file is under and its path there, from the tab's id. */
export function FileTabPane({ id, params: { key = '', '*': rel = '' } }: { id: string; params: Params }) {
  const t = useI18n()
  const { project, root, settled } = useRootOf(key)
  const { machines } = useSpaceView()
  const hrefOf = useCallback((to: string) => projectFilesHref(key, to), [key])
  const note = filesNote(t, { project, root, settled, machine: project && machineOf(machines, project.mid) })
  if (note || !project || !root) return <p className="m-6 text-muted">{note}</p>
  return (
    <ScrollScope value={`tab:${id}`}>
      <div className="flex h-full">
        <Preview mid={project.mid} root={root} rel={rel} hrefOf={hrefOf} />
      </div>
    </ScrollScope>
  )
}
