// A Mermaid file: the diagram it draws, or its source.

import { lazy, Suspense, useRef, useState } from 'react'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { SourceTools, SourceView } from './code-file'
import { FilePage, type FileViewProps, Reading } from './file-page'

// Mermaid is large; it loads with the first diagram.
const MermaidRenderer = lazy(() =>
  import('../../components/renderers/mermaid').then(m => ({ default: m.MermaidRenderer })),
)

type Mode = 'diagram' | 'source'

export function MermaidFile({ shell, text }: FileViewProps) {
  const t = useI18n()
  const [mode, setMode] = useState<Mode>('diagram')
  const source = useRef<CodeRendererHandle>(null)
  const tools = (
    <>
      <Segmented
        label={t('files.mode')}
        value={mode}
        onChange={setMode}
        segments={[
          { value: 'diagram', label: t('files.diagram') },
          { value: 'source', label: t('files.source') },
        ]}
      />
      {mode === 'source' ? <SourceTools source={source} /> : null}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView ref={source} text={text} name={shell.name} />
      ) : (
        <Suspense fallback={<Reading />}>
          <MermaidRenderer
            source={text}
            labels={{ drawing: t('files.drawing'), failed: t('files.diagramFailed') }}
          />
        </Suspense>
      )}
    </FilePage>
  )
}
