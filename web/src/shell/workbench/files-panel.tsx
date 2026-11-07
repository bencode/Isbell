// A project's files in the second column: the tree of the root the address names, marking the file
// its tab shows. It reads no file: every file opens in a tab.

import { useEffect } from 'react'
import { useI18n } from '../../core/i18n'
import { rememberFilesAt } from '../../core/prefs'
import { useSpaceView } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { useRootOf } from '../../core/worktrees'
import { filesNote } from '../../features/files/files-split'
import { Tree } from '../../features/files/tree'
import { fileTabId } from '../../features/tabs/kinds'
import { machineOf } from '../../model/space'

const NOTE = 'm-3 text-[13px] text-muted'

type Props = {
  /** The root's key, as the address has it. */
  rootKey: string
  /** The directory the address names under it, ending in '/' ('' for the root). */
  at: string
}

export function FilesPanel({ rootKey, at }: Props) {
  const t = useI18n()
  const { machines } = useSpaceView()
  const { project, roots, root, settled } = useRootOf(rootKey)
  const { active, recent } = useTabRoute()
  const shown = active ?? recent
  const { keep } = useTabActions()
  useEffect(() => {
    if (project && root) rememberFilesAt(project.key, root.key, at)
  }, [project, root, at])

  // Until the projects and worktrees settle, one not found may yet appear.
  if ((!project || !root) && !settled) return <p className={NOTE}>{t('board.loading')}</p>
  if (!project) return <p className={NOTE}>{t('project.gone')}</p>
  const note = filesNote(t, project, machineOf(machines, project.mid), root)
  if (note || !root) return <p className={NOTE}>{note}</p>
  const tabs = fileTabId(root.key, '')
  return (
    <div className="flex min-h-0 flex-1">
      <Tree
        mid={project.mid}
        project={project}
        roots={roots}
        root={root}
        dir={at.slice(0, -1)}
        current={shown?.startsWith(tabs) ? shown.slice(tabs.length) : ''}
        onPin={rel => keep(fileTabId(root.key, rel))}
      />
    </div>
  )
}
