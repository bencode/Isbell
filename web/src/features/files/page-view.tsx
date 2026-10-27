// A page under a pane's project, such as a design draft, on its own in the window: opened in a tab of
// its own, it connects and reads its files itself, so the tab it came from may close.

import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router'
import { HtmlRenderer } from '../../components/renderers/html'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { assetReader } from '../../model/files/assets'
import { join, nameOf } from '../../model/files/paths'
import { PREVIEW_MAX, read } from '../../model/files/remote'
import { locate } from '../../model/projects'

export function PageView() {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const rel = params['*'] ?? ''
  const { openStream } = useSpace()
  const view = useSpaceView()
  const project = locate(useProjects(), mid, params.pane ?? '')?.project
  const root = project?.path
  const asset = useMemo(
    () => (root ? assetReader(under => read(openStream, mid, join(root, under), PREVIEW_MAX)) : undefined),
    [openStream, mid, root],
  )

  useEffect(() => {
    document.title = nameOf(rel)
  }, [rel])

  const note = !view.loaded
    ? t('board.loading')
    : !project
      ? t('files.gone')
      : !project.online
        ? t('files.offline')
        : !asset
          ? t('files.noRoot')
          : undefined
  if (note || !asset) return <p className="m-6 text-muted">{note}</p>
  return (
    <div className="flex h-screen flex-col">
      <HtmlRenderer entry={rel} title={nameOf(rel)} read={asset} />
    </div>
  )
}
