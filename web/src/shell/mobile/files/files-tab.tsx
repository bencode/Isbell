// A phone's Files tab: the files of the project last browsed there, or at first of the one last
// active, to look through what is kept in it; another project or worktree is picked above them. A file
// read opens over the tab, at its address, as from anywhere else.

import type { ReactNode } from 'react'
import { useI18n } from '../../../core/i18n'
import { setFilesTab, useLocal } from '../../../core/prefs'
import { useProjects, useSpaceView } from '../../../core/space'
import { useRootOf } from '../../../core/worktrees'
import { filesNote } from '../../../features/files/notes'
import { parseRootKey } from '../../../model/files/worktrees'
import { latestOnline, type Project } from '../../../model/projects'
import { machineOf, projectsSettled } from '../../../model/space'
import { PhoneBar } from '../bar'
import { MoreMenu } from '../more-menu'
import { ProjectSheet } from '../sessions/project-sheet'
import { TabBar, TabTitle } from '../tab-bar'
import { FilesTree } from './tree'

export function PhoneFilesTab() {
  const t = useI18n()
  const settled = projectsSettled(useSpaceView())
  const { filesTab } = useLocal().layout
  const listed = useProjects().filter(p => p.path)
  const kept = filesTab && listed.some(p => p.key === parseRootKey(filesTab).project) ? filesTab : undefined
  const rootKey = kept ?? (settled ? latestOnline(listed)?.key : undefined)
  return (
    <>
      {rootKey ? (
        <Browse key={rootKey} rootKey={rootKey} listed={listed} />
      ) : (
        <>
          <Bar />
          <p className="m-0 p-4 text-muted">{t(settled ? 'mobile.noProject' : 'board.loading')}</p>
        </>
      )}
      <TabBar />
    </>
  )
}

function Bar({ under }: { under?: ReactNode }) {
  const t = useI18n()
  return (
    <PhoneBar under={under}>
      <TabTitle>{t('workbench.files')}</TabTitle>
      <MoreMenu />
    </PhoneBar>
  )
}

function Browse({ rootKey, listed }: { rootKey: string; listed: Project[] }) {
  const t = useI18n()
  const { machines } = useSpaceView()
  const { project, roots, root, settled } = useRootOf(rootKey)
  const note = filesNote(t, { project, root, settled, machine: project && machineOf(machines, project.mid) })
  const picker = project ? (
    <ProjectSheet projects={listed} current={project} onPick={p => setFilesTab(p.key)} />
  ) : null
  if (note || !project || !root)
    return (
      <>
        <Bar under={<div className="flex border-t border-line px-2.5 py-2">{picker}</div>} />
        <p className="m-0 p-4 text-muted">{note}</p>
      </>
    )
  return (
    <FilesTree
      project={project}
      roots={roots}
      root={root}
      dir=""
      start={<TabTitle>{t('workbench.files')}</TabTitle>}
      end={<MoreMenu />}
      picker={picker}
      onRoot={at => setFilesTab(at.key)}
      underTabs
    />
  )
}
