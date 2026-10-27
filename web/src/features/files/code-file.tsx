// A text file read as source; also the source mode of the files that render, with the same tools.

import { Search, WrapText } from 'lucide-react'
import { lazy, type RefObject, Suspense, useMemo, useRef } from 'react'
import { Button } from '../../components/button'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { type Key, useI18n } from '../../core/i18n'
import { toggleWrap, useLocal } from '../../core/prefs'
import { FilePage, type FileViewProps, Reading, useHistoryScroll } from './file-page'

// CodeMirror loads with the first file shown as source; each grammar with its first file.
const CodeRenderer = lazy(() =>
  import('../../components/renderers/code').then(m => ({ default: m.CodeRenderer })),
)

/** The search panel's words, by CodeMirror's English ones. */
const PHRASES: Record<string, Key> = {
  Find: 'files.cm.find',
  next: 'files.cm.next',
  previous: 'files.cm.previous',
  all: 'files.cm.all',
  'match case': 'files.cm.matchCase',
  regexp: 'files.cm.regexp',
  'by word': 'files.cm.byWord',
  close: 'files.cm.close',
  'Go to line': 'files.cm.goTo',
  go: 'files.cm.go',
}

export function SourceView({
  text,
  name,
  ref,
}: {
  text: string
  name: string
  ref: RefObject<CodeRendererHandle | null>
}) {
  const t = useI18n()
  const { wrap } = useLocal().layout
  const scroll = useHistoryScroll()
  const labels = useMemo(
    () => ({
      source: t('files.sourceOf', { name }),
      phrases: Object.fromEntries(Object.entries(PHRASES).map(([phrase, key]) => [phrase, t(key)])),
    }),
    [t, name],
  )
  return (
    <Suspense fallback={<Reading />}>
      {/* A new history entry starts at its own scroll. */}
      <CodeRenderer
        key={scroll.key}
        ref={ref}
        text={text}
        name={name}
        wrap={wrap}
        labels={labels}
        scroll={scroll}
      />
    </Suspense>
  )
}

/** Search in the source, and whether its long lines wrap. */
export function SourceTools({ source }: { source: RefObject<CodeRendererHandle | null> }) {
  const t = useI18n()
  const { wrap } = useLocal().layout
  return (
    <>
      <Button
        size="small"
        variant="quiet"
        aria-label={t('files.findInFile')}
        title={t('files.findInFile')}
        onClick={() => source.current?.openSearch()}
      >
        <Search size={15} />
      </Button>
      <Button
        size="small"
        variant="quiet"
        aria-pressed={wrap}
        aria-label={t('files.wrap')}
        title={t('files.wrap')}
        className="aria-pressed:bg-raised-2 aria-pressed:text-text"
        onClick={toggleWrap}
      >
        <WrapText size={15} />
      </Button>
    </>
  )
}

export function CodeFile({ shell, text }: FileViewProps) {
  const source = useRef<CodeRendererHandle>(null)
  return (
    <FilePage shell={shell} tools={<SourceTools source={source} />}>
      <SourceView ref={source} text={text} name={shell.name} />
    </FilePage>
  )
}
