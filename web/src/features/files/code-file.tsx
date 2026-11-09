// A text file read as source; also the source mode of the files that render, with the same tools.

import { Search, WrapText } from 'lucide-react'
import { lazy, type RefObject, Suspense, useMemo, useRef } from 'react'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { type Key, useI18n } from '../../core/i18n'
import { toggleWrap, useLocal } from '../../core/prefs'
import { FilePage, type FileViewProps, Reading, TOOL_ON, useTabScroll } from './file-page'

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
  wrap,
  ref,
}: {
  text: string
  name: string
  /** Whether long lines wrap, where not the reader's setting. */
  wrap?: boolean
  ref: RefObject<CodeRendererHandle | null>
}) {
  const t = useI18n()
  const { wrap: wrapped } = useLocal().layout
  const scroll = useTabScroll()
  const labels = useMemo(
    () => ({
      source: t('files.sourceOf', { name }),
      phrases: Object.fromEntries(Object.entries(PHRASES).map(([phrase, key]) => [phrase, t(key)])),
    }),
    [t, name],
  )
  return (
    <Suspense fallback={<Reading />}>
      <CodeRenderer
        ref={ref}
        text={text}
        name={name}
        wrap={wrap ?? wrapped}
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
      <IconButton label={t('files.findInFile')} size="small" onClick={() => source.current?.openSearch()}>
        <Search {...SMALL_ICON} />
      </IconButton>
      <IconButton
        label={t('files.wrap')}
        size="small"
        aria-pressed={wrap}
        className={TOOL_ON}
        onClick={toggleWrap}
      >
        <WrapText {...SMALL_ICON} />
      </IconButton>
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
