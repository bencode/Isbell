// An image file: fitted to the space or zoomed, and for an SVG, its source too.

import { Maximize2, Minus, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Button } from '../../components/button'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import type { CodeRendererHandle } from '../../components/renderers/code'
import { ImageRenderer } from '../../components/renderers/image'
import { Segmented } from '../../components/segmented'
import { useI18n } from '../../core/i18n'
import { decodeText } from '../../model/files/content'
import { useObjectUrl } from '../../utils/object-url'
import { SourceTools, SourceView } from './code-file'
import { FilePage, type FileShell, Reading, TOOL_ON } from './file-page'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

type Mode = 'image' | 'source'

type Props = { shell: FileShell; bytes: Uint8Array<ArrayBuffer>; type: string }

export function ImageFile({ shell, bytes, type }: Props) {
  const t = useI18n()
  const blob = useMemo(() => new Blob([bytes], { type }), [bytes, type])
  const src = useObjectUrl(blob)
  const text = useMemo(() => (type === 'image/svg+xml' ? decodeText(bytes) : null), [bytes, type])
  const [mode, setMode] = useState<Mode>('image')
  const source = useRef<CodeRendererHandle>(null)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const zoomTo = (next: number) => {
    setFit(false)
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)))
  }

  const tools = (
    <>
      {text !== null ? (
        <Segmented
          compact
          label={t('files.mode')}
          value={mode}
          onChange={setMode}
          segments={[
            { value: 'image', label: t('files.picture') },
            { value: 'source', label: t('files.source') },
          ]}
        />
      ) : null}
      {mode === 'source' ? (
        <SourceTools source={source} />
      ) : (
        <>
          <IconButton
            label={t('files.zoomOut')}
            size="small"
            disabled={!fit && zoom <= ZOOM_MIN}
            onClick={() => zoomTo(zoom - ZOOM_STEP)}
          >
            <Minus {...SMALL_ICON} />
          </IconButton>
          <Button
            size="tiny"
            variant="quiet"
            title={t('files.actualSize')}
            className="min-w-[42px] justify-center font-mono text-[11.5px]"
            onClick={() => zoomTo(1)}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <IconButton
            label={t('files.zoomIn')}
            size="small"
            disabled={!fit && zoom >= ZOOM_MAX}
            onClick={() => zoomTo(zoom + ZOOM_STEP)}
          >
            <Plus {...SMALL_ICON} />
          </IconButton>
          <IconButton
            label={t('files.fit')}
            size="small"
            aria-pressed={fit}
            className={TOOL_ON}
            onClick={() => setFit(true)}
          >
            <Maximize2 {...SMALL_ICON} />
          </IconButton>
        </>
      )}
    </>
  )
  return (
    <FilePage shell={shell} tools={tools}>
      {mode === 'source' && text !== null ? (
        <SourceView ref={source} text={text} name={shell.name} />
      ) : src ? (
        <ImageRenderer
          src={src}
          alt={shell.name}
          scale={fit ? { fit: true } : { fit: false, zoom }}
          failed={t('files.imageFailed')}
        />
      ) : (
        <Reading />
      )}
    </FilePage>
  )
}
