// A Markdown file: a document to read, in the reader's text size and width, or its source. A link
// to another file under the root opens it here.

import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/button'
import type { MarkdownLabels, MarkdownLink } from '../../components/renderers/markdown'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { setReader, useLocal } from '../../core/prefs'
import { resolveLink } from '../../model/files/paths'
import { SourceView } from './code-file'
import { FilePage, type FileViewProps, Reading, Scroller } from './file-page'

// The Markdown libraries load with the first document rendered.
const MarkdownRenderer = lazy(() =>
  import('../../components/renderers/markdown').then(m => ({ default: m.MarkdownRenderer })),
)

type Mode = 'rendered' | 'source'

/** Aa steps through the text sizes. */
const NEXT_SIZE = { s: 'm', m: 'l', l: 's' } as const

export function MarkdownFile({ shell, text, rel, hrefOf }: FileViewProps) {
  const t = useI18n()
  const navigate = useNavigate()
  const reader = useLocal().layout.reader
  const [mode, setMode] = useState<Mode>('rendered')

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
    () => ({ outline: t('files.outline'), image: alt => t('files.image', { alt }) }),
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
      {mode === 'rendered' ? (
        <>
          <Button
            size="small"
            variant="quiet"
            title={t('files.textSize')}
            onClick={() => setReader({ size: NEXT_SIZE[reader.size] })}
          >
            Aa
          </Button>
          <Button
            size="small"
            variant="quiet"
            aria-pressed={reader.wide}
            className="aria-pressed:bg-raised-2 aria-pressed:text-text"
            onClick={() => setReader({ wide: !reader.wide })}
          >
            {t('files.wide')}
          </Button>
        </>
      ) : null}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView text={text} name={shell.name} />
      ) : (
        <Suspense fallback={<Reading />}>
          <Scroller>
            {scroller => (
              <MarkdownRenderer
                text={text}
                appearance={reader}
                link={link}
                labels={labels}
                scroller={scroller}
              />
            )}
          </Scroller>
        </Suspense>
      )}
    </FilePage>
  )
}
