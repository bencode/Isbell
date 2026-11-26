// A drawn diagram on a canvas to look around: the wheel zooms at the pointer, a drag moves it, and
// the tools fit it to the canvas or show it at its own size.

import Panzoom, { type PanzoomEventDetail, type PanzoomObject } from '@panzoom/panzoom'
import { Minus, Plus, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { IconButton, SMALL_ICON } from '../../icon-button'
import { Tip } from '../../tip'
import type { DiagramLabels, Drawing } from './diagram'

/** What a fit leaves around the diagram. */
const MARGIN = 0.96
/** What a zoom button multiplies the scale by. */
const STEP = 1.25
const MIN_SCALE = 0.05
const MAX_SCALE = 8

/** A tool that is a word, beside ones that are icons. */
export function TextTool({
  tip,
  onClick,
  children,
}: {
  tip: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tip label={tip}>
      <button
        type="button"
        aria-label={tip}
        onClick={onClick}
        className="h-6 cursor-pointer rounded-md border-0 bg-transparent px-2 font-mono text-xs text-muted transition-colors duration-75 hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent active:bg-press"
      >
        {children}
      </button>
    </Tip>
  )
}

type Placement = { scale: number; x: number; y: number }

/**
 * At `scale`, or fitted, its middle in the stage's middle and its top in view when it is taller.
 * Panzoom scales it about its middle (which its zoom at the pointer counts on), then moves it by the
 * pan in its own units: its corner lands at `c + s(x - c)` for a half size `c`.
 */
function placement(stage: HTMLElement, { width, height }: Drawing, scale: number | 'fit'): Placement {
  const box = stage.getBoundingClientRect()
  const wanted = scale === 'fit' ? Math.min(box.width / width, box.height / height) * MARGIN : scale
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, wanted))
  const corner = (at: number, size: number) => (at - size / 2) / s + size / 2
  return {
    scale: s,
    x: corner((box.width - width * s) / 2, width),
    y: corner(Math.max(0, (box.height - height * s) / 2), height),
  }
}

function show(pz: PanzoomObject, { scale, x, y }: Placement) {
  pz.zoom(scale, { animate: false })
  pz.pan(x, y, { animate: false })
}

export function ZoomCanvas({
  drawing,
  labels,
  onClose,
}: {
  drawing: Drawing
  labels: DiagramLabels
  /** In a viewer, what closes it. */
  onClose?: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const zoomer = useRef<PanzoomObject>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const parent = stage.current
    const elem = image.current
    if (!parent || !elem) return
    // Fitted from the start: Panzoom moves to its start once it has measured, after anything set here.
    const fit = placement(parent, drawing, 'fit')
    const pz = Panzoom(elem, {
      canvas: true,
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      cursor: '',
      startScale: fit.scale,
      startX: fit.x,
      startY: fit.y,
    })
    zoomer.current = pz
    const changed = (e: Event) => setScale((e as CustomEvent<PanzoomEventDetail>).detail.scale)
    elem.addEventListener('panzoomchange', changed)
    parent.addEventListener('wheel', pz.zoomWithWheel)
    return () => {
      parent.removeEventListener('wheel', pz.zoomWithWheel)
      elem.removeEventListener('panzoomchange', changed)
      pz.destroy()
      zoomer.current = null
    }
  }, [drawing])

  const act = (f: (pz: PanzoomObject, parent: HTMLElement) => void) => () => {
    if (zoomer.current && stage.current) f(zoomer.current, stage.current)
  }
  // About the stage's middle.
  const zoomBy = (factor: number) =>
    act((pz, parent) => {
      const box = parent.getBoundingClientRect()
      pz.zoomToPoint(pz.getScale() * factor, {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      })
    })
  const divider = <span className="mx-[5px] h-3.5 w-px bg-line" />

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
      <div ref={stage} className="absolute inset-0 cursor-grab active:cursor-grabbing">
        <img
          ref={image}
          alt=""
          src={drawing.src}
          width={drawing.width}
          height={drawing.height}
          draggable={false}
          className="block max-w-none select-none"
        />
      </div>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 rounded-lg border border-line bg-raised p-[3px] shadow-[0_2px_10px_rgb(0_0_0/0.14)]">
        <IconButton label={labels.zoomOut} size="small" onClick={zoomBy(1 / STEP)}>
          <Minus {...SMALL_ICON} />
        </IconButton>
        <span className="min-w-[46px] text-center font-mono text-xs text-muted">
          {Math.round(scale * 100)}%
        </span>
        <IconButton label={labels.zoomIn} size="small" onClick={zoomBy(STEP)}>
          <Plus {...SMALL_ICON} />
        </IconButton>
        {divider}
        <TextTool tip={labels.fit} onClick={act((pz, parent) => show(pz, placement(parent, drawing, 'fit')))}>
          {labels.fit}
        </TextTool>
        <TextTool tip={labels.actual} onClick={act((pz, parent) => show(pz, placement(parent, drawing, 1)))}>
          1:1
        </TextTool>
        {onClose ? (
          <>
            {divider}
            <IconButton label={labels.close} size="small" onClick={onClose}>
              <X {...SMALL_ICON} />
            </IconButton>
          </>
        ) : null}
      </div>
      <span className="pointer-events-none absolute bottom-2.5 left-3 rounded bg-white/85 px-2 py-0.5 text-xs text-[#62687a]">
        {labels.hint}
      </span>
    </div>
  )
}
