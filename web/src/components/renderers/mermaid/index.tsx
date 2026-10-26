// A Mermaid file, drawn.

import { MermaidDiagram } from './diagram'

export function MermaidRenderer({
  source,
  labels,
}: {
  source: string
  labels: { drawing: string; failed: string }
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <MermaidDiagram source={source} labels={labels}>
        <pre className="m-0 overflow-x-auto rounded-lg bg-raised-2 p-4 font-mono text-[12.5px]">{source}</pre>
      </MermaidDiagram>
    </div>
  )
}
