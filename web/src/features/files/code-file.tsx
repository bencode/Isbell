// A text file read as source; also the source mode of the files that render.

import { lazy, Suspense } from 'react'
import { FilePage, type FileViewProps, Reading, Scroller } from './file-page'

// Highlighting loads with the first file shown as source.
const CodeRenderer = lazy(() =>
  import('../../components/renderers/code').then(m => ({ default: m.CodeRenderer })),
)

export function SourceView({ text, name }: { text: string; name: string }) {
  return (
    <Suspense fallback={<Reading />}>
      <Scroller>{() => <CodeRenderer text={text} name={name} />}</Scroller>
    </Suspense>
  )
}

export function CodeFile({ shell, text }: FileViewProps) {
  return (
    <FilePage shell={shell}>
      <SourceView text={text} name={shell.name} />
    </FilePage>
  )
}
