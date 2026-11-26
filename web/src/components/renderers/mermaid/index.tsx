// A Mermaid file, drawn on a canvas that fills the page, to zoom and move around.

import { type DiagramLabels, useMermaid } from './diagram'
import { ZoomCanvas } from './zoom-canvas'

export function MermaidRenderer({ source, labels }: { source: string; labels: DiagramLabels }) {
  const drawn = useMermaid(source)
  if (drawn && 'src' in drawn) return <ZoomCanvas drawing={drawn} labels={labels} />
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <p className="m-0 mb-2 text-[0.85em] text-faint">{drawn ? labels.failed : labels.drawing}</p>
      <pre className="m-0 overflow-x-auto rounded-lg bg-raised-2 p-4 font-mono text-[12.5px]">{source}</pre>
    </div>
  )
}
