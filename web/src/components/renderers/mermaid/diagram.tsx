// A Mermaid diagram, drawn off screen and shown as an image, so nothing in it runs or reacts. The
// source stays in view while it draws and when it cannot be drawn.

import mermaid from 'mermaid'
import { type ReactNode, useEffect, useState } from 'react'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  theme: 'neutral',
  fontFamily: 'system-ui, sans-serif',
})

type Drawn = { source: string; svg: string; width: number | undefined } | { source: string; failed: true }

export function MermaidDiagram({
  source,
  labels,
  children,
}: {
  source: string
  labels: { drawing: string; failed: string }
  children: ReactNode
}) {
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
          const width = Number(
            new DOMParser()
              .parseFromString(svg, 'image/svg+xml')
              .documentElement.getAttribute('viewBox')
              ?.split(/[\s,]+/)[2],
          )
          if (live) setDrawn({ source, svg, width: width > 0 ? width : undefined })
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
  const now = drawn?.source === source ? drawn : undefined
  if (now && 'svg' in now)
    return (
      <figure data-wide className="m-0 overflow-x-auto rounded-lg border border-line bg-white p-4">
        <img
          alt=""
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(now.svg)}`}
          width={now.width}
          className="mx-auto my-0 block max-w-none"
        />
      </figure>
    )
  return (
    <figure data-wide className="m-0">
      <p className="m-0 mb-2 text-[0.85em] text-faint">{now ? labels.failed : labels.drawing}</p>
      {children}
    </figure>
  )
}
