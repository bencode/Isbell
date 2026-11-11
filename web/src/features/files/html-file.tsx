// An HTML file: run apart from the app with the files beside it, here or in a tab of its own; or its
// source.

import { ExternalLink, Shield } from 'lucide-react'
import { useRef, useState } from 'react'
import { iconButtonClass, SMALL_ICON } from '../../components/icon-button'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { HtmlRenderer } from '../../components/renderers/html'
import { Segmented } from '../../components/segmented'
import { Tip } from '../../components/tip'
import { useI18n } from '../../core/i18n'
import { SourceTools, SourceView } from './code-file'
import { FilePage, type FileViewProps } from './file-page'
import { ShareButton } from './share-button'

type Mode = 'preview' | 'source'

export function HtmlFile({ shell, text, rel, asset, apartHref, share }: FileViewProps) {
  const t = useI18n()
  const [mode, setMode] = useState<Mode>('preview')
  const source = useRef<CodeRendererHandle>(null)
  const tools = (
    <>
      <Segmented
        compact
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
        <>
          <Tip label={t('files.sandboxed')}>
            <span
              role="img"
              aria-label={t('files.sandboxed')}
              className="inline-grid size-6 flex-none place-items-center text-muted"
            >
              <Shield {...SMALL_ICON} />
            </span>
          </Tip>
          <Tip label={t('files.openApart')}>
            <a
              href={apartHref}
              target="_blank"
              rel="noopener"
              aria-label={t('files.openApart')}
              className={iconButtonClass('small')}
            >
              <ExternalLink {...SMALL_ICON} />
            </a>
          </Tip>
          <ShareButton {...share} />
        </>
      )}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' ? (
        <SourceView ref={source} text={text} name={shell.name} />
      ) : (
        <HtmlRenderer entry={rel} title={shell.name} read={asset} />
      )}
    </FilePage>
  )
}
