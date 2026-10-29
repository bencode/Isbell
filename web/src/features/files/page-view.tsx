// A page under a project, such as a design draft, on its own in the window: opened in a tab of
// its own, it connects and reads its files itself, so the tab it came from may close.

import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router'
import { HtmlRenderer } from '../../components/renderers/html'
import { useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { useRootOf } from '../../core/worktrees'
import { assetReader } from '../../model/files/assets'
import { join, nameOf } from '../../model/files/paths'
import { PREVIEW_MAX, read } from '../../model/files/remote'

export function PageView() {
  const t = useI18n()
  const params = useParams()
  const rel = params['*'] ?? ''
  const { openStream } = useSpace()
  const { project, root: at, settled } = useRootOf(params.key ?? '')
  const mid = project?.mid ?? ''
  const root = at?.path
  const asset = useMemo(
    () => (root ? assetReader(under => read(openStream, mid, join(root, under), PREVIEW_MAX)) : undefined),
    [openStream, mid, root],
  )

  useEffect(() => {
    document.title = nameOf(rel)
  }, [rel])

  // Until the projects and worktrees settle, one not found may yet appear.
  const note = !project
    ? settled
      ? t('project.gone')
      : t('board.loading')
    : !project.online
      ? t('files.offline')
      : !at
        ? settled
          ? t('files.branchGone')
          : t('board.loading')
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
