// A Mermaid diagram, drawn off screen and shown as an image, so nothing in it runs or reacts. The
// source stays in view while it draws and when it cannot be drawn. In a document it fits the column,
// or shows at its own size; opened, it fills the window to zoom and move around.

import { Dialog } from '@base-ui/react/dialog'
import { Expand } from 'lucide-react'
import mermaid from 'mermaid'
import { type ReactNode, useEffect, useState } from 'react'
import { IconButton, SMALL_ICON } from '../../icon-button'
import { TextTool, ZoomCanvas } from './zoom-canvas'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  theme: 'neutral',
  fontFamily: 'system-ui, sans-serif',
})

export type DiagramLabels = {
  drawing: string
  failed: string
  open: string
  zoomIn: string
  zoomOut: string
  fit: string
  actual: string
  close: string
  hint: string
}

/** A diagram drawn: an image of it, at the size it was drawn. */
export type Drawing = { src: string; width: number; height: number }

type Drawn = { source: string; drawing: Drawing } | { source: string; failed: true }

/** Its size, from the drawing's viewBox: `min-x min-y width height`. */
function sizeOf(svg: string) {
  const box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox')
  const [, , width, height] = (box ?? '').split(/[\s,]+/).map(Number)
  return width && height && width > 0 && height > 0 ? { width, height } : undefined
}

/** The source drawn, `failed`, or undefined while it draws. */
export function useMermaid(source: string): Drawing | { failed: true } | undefined {
  const [drawn, setDrawn] = useState<Drawn>()
  useEffect(() => {
    let live = true
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden'
    document.body.append(box)
    mermaid
      .render(`mermaid-${crypto.randomUUID()}`, source, box)
      .then(
        ({ svg }) => {
          const size = sizeOf(svg)
          if (!size) console.warn('a drawn diagram has no viewBox to size it by')
          if (!live) return
          const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
          setDrawn(size ? { source, drawing: { src, ...size } } : { source, failed: true })
        },
        (err: unknown) => {
          console.warn('could not draw a diagram', err)
          if (live) setDrawn({ source, failed: true })
        },
      )
      .finally(() => box.remove())
    return () => {
      live = false
    }
  }, [source])
  // A result for an older source is not this diagram's.
  if (drawn?.source !== source) return undefined
  return 'drawing' in drawn ? drawn.drawing : { failed: true }
}

export function MermaidDiagram({
  source,
  labels,
  children,
}: {
  source: string
  labels: DiagramLabels
  children: ReactNode
}) {
  const drawn = useMermaid(source)
  const [actual, setActual] = useState(false)
  const [open, setOpen] = useState(false)
  if (drawn && 'src' in drawn)
    return (
      <figure data-wide className="group relative m-0">
        <div className={`rounded-lg border border-line bg-white p-4 ${actual ? 'overflow-x-auto' : ''}`}>
          <button
            type="button"
            aria-label={labels.open}
            onClick={() => setOpen(true)}
            className="mx-auto block cursor-zoom-in border-0 bg-transparent p-0"
          >
            <img
              alt=""
              src={drawn.src}
              width={drawn.width}
              height={drawn.height}
              className={`my-0 block h-auto ${actual ? 'max-w-none' : 'max-w-full'}`}
            />
          </button>
        </div>
        <div className="absolute top-2 right-2 flex gap-0.5 rounded-[7px] border border-line bg-raised p-0.5 opacity-0 shadow-[0_2px_8px_rgb(0_0_0/0.12)] transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
          <TextTool tip={actual ? labels.fit : labels.actual} onClick={() => setActual(!actual)}>
            {actual ? labels.fit : '1:1'}
          </TextTool>
          <IconButton label={labels.open} size="small" onClick={() => setOpen(true)}>
            <Expand {...SMALL_ICON} />
          </IconButton>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
            <Dialog.Popup
              aria-label={labels.open}
              className="fixed inset-3 z-50 flex overflow-hidden rounded-xl border border-line-strong shadow-[0_16px_48px_rgb(0_0_0/0.3)] outline-none"
            >
              <ZoomCanvas drawing={drawn} labels={labels} onClose={() => setOpen(false)} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </figure>
    )
  return (
    <figure data-wide className="m-0">
      <p className="m-0 mb-2 text-[0.85em] text-faint">{drawn ? labels.failed : labels.drawing}</p>
      {children}
    </figure>
  )
}
