// A project's files, laid out: the tree on the left, opened at a directory, and the file read on the
// right; or why there are none to show.

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { ResizeHandle } from '../../components/resize-handle'
import { type T, useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import type { FilesRoot } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import { type MachineEntry, machineOf } from '../../model/space'
import { Preview } from './preview'
import { Tree } from './tree'

const PANELS = ['tree', 'file']

type Props = {
  mid: string
  project: Project
  /** Where the project's files may be browsed: its own directory, then its other worktrees. */
  roots: FilesRoot[]
  /** The one the address names; none when that worktree is gone. */
  root: FilesRoot | undefined
  /** The directory the tree opens down to, relative to the root ('' for none). */
  dir: string
  /** The file read, relative to the root. */
  rel: string
  hrefOf: (rel: string) => string
}

/** Why a project's files cannot be browsed, if they cannot. */
export const filesNote = (
  t: T,
  project: Project,
  machine: MachineEntry | undefined,
  root: FilesRoot | undefined,
): string | undefined =>
  !project.online
    ? t('files.offline')
    : !machine?.state.caps.methods.includes('isbell.file.list')
      ? t('files.old')
      : !project.path
        ? t('files.noRoot')
        : !root
          ? t('files.branchGone')
          : undefined

export function FilesSplit({ mid, project, roots, root, dir, rel, hrefOf }: Props) {
  const t = useI18n()
  const machine = machineOf(useSpaceView().machines, mid)
  // The tree's width, the same for every project.
  const split = useDefaultLayout({ id: 'isbell.files-split', panelIds: PANELS, storage: localStorage })

  const note = filesNote(t, project, machine, root)
  if (note || !root) return <p className="m-6 text-muted">{note}</p>
  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={split.defaultLayout}
      onLayoutChanged={split.onLayoutChanged}
    >
      {/* Keeps its width as the window resizes. */}
      <Panel
        id="tree"
        className="flex"
        defaultSize="300px"
        minSize="200px"
        maxSize="50%"
        groupResizeBehavior="preserve-pixel-size"
      >
        <Tree mid={mid} project={project} roots={roots} root={root} dir={dir} current={rel} />
      </Panel>
      <ResizeHandle label={t('files.resize')} />
      <Panel id="file" className="flex" minSize="320px">
        {/* Keyed, so each file starts with its own view mode and scroll. */}
        <Preview key={rel} mid={mid} root={root} rel={rel} hrefOf={hrefOf} />
      </Panel>
    </Group>
  )
}
