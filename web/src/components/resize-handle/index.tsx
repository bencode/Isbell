import { Separator } from 'react-resizable-panels'

/** The line between two resizable panels: thin, with a wider grip, lit while pointed at, focused or
 * dragged. Arrow keys move it once focused. */
export function ResizeHandle({ label }: { label: string }) {
  return (
    <Separator
      aria-label={label}
      title={label}
      className="relative w-px flex-none bg-line outline-none before:absolute before:inset-y-0 before:-right-1 before:-left-1 before:content-[''] data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent"
    />
  )
}
