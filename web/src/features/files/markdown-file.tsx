// A Markdown file: a document to read, in the reader's appearance and with its outline, or its
// source. A link to another file under the root opens it here.

import { ListTree } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import type { MarkdownLabels, MarkdownLink, OutlineLayout } from '../../components/renderers/markdown'
import type { AppearanceLabels } from '../../components/renderers/markdown/appearance-control'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { setReader, useLocal } from '../../core/prefs'
import { resolveLink } from '../../model/files/paths'
import { SourceView } from './code-file'
import { FilePage, type FileViewProps, Reading, useHistoryScroll } from './file-page'

// The Markdown libraries load with the first document rendered, and the Aa panel with them.
const MarkdownRenderer = lazy(() =>
  import('../../components/renderers/markdown').then(m => ({ default: m.MarkdownRenderer })),
)
const AppearanceControl = lazy(() =>
  import('../../components/renderers/markdown/appearance-control').then(m => ({
    default: m.AppearanceControl,
  })),
)

type Mode = 'rendered' | 'source'

export function MarkdownFile({ shell, text, rel, hrefOf }: FileViewProps) {
  const t = useI18n()
  const navigate = useNavigate()
  const reader = useLocal().reader
  const scroll = useHistoryScroll()
  const [mode, setMode] = useState<Mode>('rendered')
  const [outline, setOutline] = useState<{ available: boolean; layout: OutlineLayout }>({
    available: false,
    layout: 'beside',
  })
  // Beside the document the outline stays as the reader left it; over it, it opens only on demand.
  const [overOpen, setOverOpen] = useState(false)
  const outlineOpen = outline.layout === 'beside' ? reader.outline : overOpen
  const setOutlineOpen = useCallback(
    (open: boolean) => (outline.layout === 'beside' ? setReader({ outline: open }) : setOverOpen(open)),
    [outline.layout],
  )

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
  const labels = useMemo<MarkdownLabels>(
    () => ({
      outline: t('files.outline'),
      closeOutline: t('files.closeOutline'),
      image: alt => t('files.image', { alt }),
      drawing: t('files.drawing'),
      diagramFailed: t('files.diagramFailed'),
    }),
    [t],
  )
  const appearanceLabels = useMemo<AppearanceLabels>(
    () => ({
      appearance: t('files.appearance'),
      textSize: t('files.textSize'),
      width: t('files.width'),
      focused: t('files.focused'),
      full: t('files.wide'),
      font: t('files.font'),
      sans: t('files.sans'),
      serif: t('files.serif'),
      theme: t('files.theme'),
      themes: {
        auto: t('files.themeAuto'),
        light: t('files.themeLight'),
        paper: t('files.themePaper'),
        dark: t('files.themeDark'),
      },
    }),
    [t],
  )

  const tools = (
    <>
      <Segmented
        label={t('files.mode')}
        value={mode}
        onChange={setMode}
        segments={[
          { value: 'rendered', label: t('files.rendered') },
          { value: 'source', label: t('files.source') },
        ]}
      />
      {mode === 'rendered' && outline.available ? (
        <Button
          size="small"
          variant="quiet"
          aria-pressed={outlineOpen}
          aria-label={outlineOpen ? t('files.outlineHide') : t('files.outlineShow')}
          title={outlineOpen ? t('files.outlineHide') : t('files.outlineShow')}
          className="aria-pressed:bg-raised-2 aria-pressed:text-text"
          onClick={() => setOutlineOpen(!outlineOpen)}
        >
          <ListTree size={15} />
        </Button>
      ) : null}
      {mode === 'rendered' ? (
        <Suspense>
          <AppearanceControl value={reader} onChange={setReader} labels={appearanceLabels} />
        </Suspense>
      ) : null}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView text={text} name={shell.name} />
      ) : (
        <Suspense fallback={<Reading />}>
          <MarkdownRenderer
            // A new history entry starts at its own scroll.
            key={scroll.key}
            text={text}
            appearance={reader}
            link={link}
            labels={labels}
            outline={{ open: outlineOpen, onOpenChange: setOutlineOpen, onState: setOutline }}
            scroll={scroll}
          />
        </Suspense>
      )}
    </FilePage>
  )
}
