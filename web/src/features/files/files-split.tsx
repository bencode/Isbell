// A project's files, laid out: the tree on the left, opened at a directory, and the file read on the
// right; or why there are none to show.

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { ResizeHandle } from '../../components/resize-handle'
import { useI18n } from '../../core/i18n'
import { useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import { machineOf } from '../../model/space'
import { Preview } from './preview'
import { Tree } from './tree'

const PANELS = ['tree', 'file']

type Props = {
  mid: string
  project: Project
  /** Where the tree opens, relative to the root. */
  cwd: string
  /** The file read, relative to the root. */
  rel: string
  hrefOf: (rel: string) => string
}

export function FilesSplit({ mid, project, cwd, rel, hrefOf }: Props) {
  const t = useI18n()
  const machine = machineOf(useSpaceView().machines, mid)
  // The tree's width, the same for every project.
  const split = useDefaultLayout({ id: 'isbell.files-split', panelIds: PANELS, storage: localStorage })

  const note = !project.online
    ? t('files.offline')
    : !machine?.state.caps.methods.includes('isbell.file.list')
      ? t('files.old')
      : !project.path
        ? t('files.noRoot')
        : undefined
  if (note) return <p className="m-6 text-muted">{note}</p>
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
        <Tree mid={mid} project={project} cwd={cwd} current={rel} hrefOf={hrefOf} />
      </Panel>
      <ResizeHandle label={t('files.resize')} />
      <Panel id="file" className="flex" minSize="320px">
        {/* Keyed, so each file starts with its own view mode and scroll. */}
        <Preview key={rel} mid={mid} project={project} rel={rel} hrefOf={hrefOf} />
      </Panel>
    </Group>
  )
}
