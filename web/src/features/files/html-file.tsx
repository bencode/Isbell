// An HTML file: run in a sandbox, or its source.

import { useState } from 'react'
import { HtmlRenderer } from '../../components/renderers/html'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { SourceView } from './code-file'
import { FilePage, type FileViewProps } from './file-page'

type Mode = 'preview' | 'source'

export function HtmlFile({ shell, text }: FileViewProps) {
  const t = useI18n()
  const [mode, setMode] = useState<Mode>('preview')
  const tools = (
    <Segmented
      label={t('files.mode')}
      value={mode}
      onChange={setMode}
      segments={[
        { value: 'preview', label: t('files.preview') },
        { value: 'source', label: t('files.source') },
      ]}
    />
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView text={text} name={shell.name} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="m-0 border-b border-line px-5 py-1.5 text-[12px] text-faint">
            {t('files.sandboxed')}
          </p>
          <HtmlRenderer html={text} title={shell.name} />
        </div>
      )}
    </FilePage>
  )
}
