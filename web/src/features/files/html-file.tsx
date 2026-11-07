// An HTML file: run apart from the app with the files beside it, here or in a tab of its own; or its
// source.

import { ExternalLink } from 'lucide-react'
import { useRef, useState } from 'react'
import { buttonClass } from '../../components/button'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { HtmlRenderer } from '../../components/renderers/html'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { SourceTools, SourceView } from './code-file'
import { FilePage, type FileViewProps } from './file-page'

type Mode = 'preview' | 'source'

export function HtmlFile({ shell, text, rel, asset, apartHref }: FileViewProps) {
  const t = useI18n()
  const [mode, setMode] = useState<Mode>('preview')
  const source = useRef<CodeRendererHandle>(null)
  const tools = (
    <>
      <Segmented
        label={t('files.mode')}
        value={mode}
        onChange={setMode}
        segments={[
          { value: 'preview', label: t('files.preview') },
          { value: 'source', label: t('files.source') },
        ]}
      />
      {mode === 'source' ? (
        <SourceTools source={source} />
      ) : (
        <a
          href={apartHref}
          target="_blank"
          rel="noopener"
          aria-label={t('files.openApart')}
          title={t('files.openApart')}
          className={buttonClass('quiet', '', 'small')}
        >
          <ExternalLink size={15} />
        </a>
      )}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView ref={source} text={text} name={shell.name} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="m-0 border-b border-line px-5 py-1.5 text-[12px] text-faint">
            {t('files.sandboxed')}
          </p>
          <HtmlRenderer entry={rel} title={shell.name} read={asset} />
        </div>
      )}
    </FilePage>
  )
}
