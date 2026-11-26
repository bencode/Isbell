// What a Markdown document asks of the app to render, whichever page it is read on: where its links
// lead, where its images come from, and its words.

import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { MarkdownImage, MarkdownLabels, MarkdownLink } from '../../components/renderers/markdown'
import type { DiagramLabels } from '../../components/renderers/mermaid/diagram'
import { useI18n } from '../../core/i18n'
import { resolveLink } from '../../model/files/paths'

const WEB_IMAGE = /^https?:\/\//i

/** A diagram's words, in a document or a file of its own. */
export function useDiagramLabels() {
  const t = useI18n()
  return useMemo<DiagramLabels>(
    () => ({
      drawing: t('files.drawing'),
      failed: t('files.diagramFailed'),
      open: t('files.diagramOpen'),
      zoomIn: t('files.zoomIn'),
      zoomOut: t('files.zoomOut'),
      fit: t('files.fit'),
      actual: t('files.actualSize'),
      close: t('files.diagramClose'),
      hint: t('files.zoomHint'),
    }),
    [t],
  )
}

/** `rel`: the document, relative to its root. A link to another file under the root opens it here. */
export function useMarkdownParts(
  rel: string,
  hrefOf: (rel: string) => string,
  asset: (rel: string) => Promise<Blob>,
) {
  const t = useI18n()
  const navigate = useNavigate()
  const diagram = useDiagramLabels()
  // Stable, so the document is not parsed again for them.
  const link = useCallback(
    (href: string): MarkdownLink => {
      const target = resolveLink(rel, href)
      if (target.kind !== 'file') return target
      const to = hrefOf(target.rel)
      return { kind: 'internal', href: to, open: () => navigate(to) }
    },
    [rel, hrefOf, navigate],
  )
  // From the web as it is; from under the root, read; anything else is a placeholder.
  const image = useCallback(
    (src: string): MarkdownImage => {
      if (WEB_IMAGE.test(src)) return { kind: 'url', url: src }
      const target = resolveLink(rel, src)
      return target.kind === 'file' ? { kind: 'load', load: () => asset(target.rel) } : { kind: 'none' }
    },
    [rel, asset],
  )
  const labels = useMemo<MarkdownLabels>(
    () => ({
      outline: t('files.outline'),
      closeOutline: t('files.closeOutline'),
      image: alt => t('files.image', { alt }),
      diagram,
    }),
    [t, diagram],
  )
  return { link, image, labels }
}
