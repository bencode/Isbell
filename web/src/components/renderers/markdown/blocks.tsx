// How the parts of a document render: links as the caller says, images as placeholders, tables
// that scroll sideways, and Mermaid fences drawn as diagrams (loaded the first time one appears).

import {
  Children,
  Component,
  isValidElement,
  lazy,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  Suspense,
} from 'react'
import type { Components } from 'react-markdown'
import styles from './markdown.module.scss'

/** How one link behaves: jump within the document, open in a new tab, open in the app, or nothing. */
export type MarkdownLink =
  | { kind: 'anchor'; id: string }
  | { kind: 'external' }
  /** Shown with `href`; a plain click calls `open`, a modified one is the browser's. */
  | { kind: 'internal'; href: string; open: () => void }
  | { kind: 'inert' }

export type MarkdownLabels = {
  outline: string
  closeOutline: string
  image: (alt: string) => string
  drawing: string
  diagramFailed: string
}

const MermaidDiagram = lazy(() => import('../mermaid/diagram').then(m => ({ default: m.MermaidDiagram })))

export function blocks({
  link,
  labels,
  jump,
}: {
  link: (href: string) => MarkdownLink
  labels: MarkdownLabels
  jump: (id: string) => void
}): Components {
  return {
    a: ({ href = '', children }) => (
      <DocLink link={link(href)} href={href} jump={jump}>
        {children}
      </DocLink>
    ),
    img: ({ alt }) => <span className="text-faint">{labels.image(alt ?? '')}</span>,
    table: ({ node: _node, ...props }) => (
      <div className={styles.table}>
        <table {...props} />
      </div>
    ),
    pre: ({ node: _node, children, ...props }) => {
      const block = <pre {...props}>{children}</pre>
      const source = mermaidSource(children)
      return source === undefined ? block : <Diagram source={source} labels={labels} block={block} />
    },
  }
}

/** The source of a ```mermaid fence, or undefined for any other block. */
function mermaidSource(children: ReactNode): string | undefined {
  const code = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined
  if (!code?.props.className?.split(' ').includes('language-mermaid')) return undefined
  return Children.toArray(code.props.children).join('').replace(/\n$/, '')
}

function Diagram({
  source,
  labels,
  block,
}: {
  source: string
  labels: MarkdownLabels
  /** The fence as code, shown while drawing and when a diagram cannot be drawn. */
  block: ReactNode
}) {
  const note = (text: string) => <p className="m-0 mb-2 text-[0.85em] text-faint">{text}</p>
  return (
    <DiagramBoundary
      fallback={
        <figure data-wide className="m-0">
          {note(labels.diagramFailed)}
          {block}
        </figure>
      }
    >
      <Suspense
        fallback={
          <figure data-wide className="m-0">
            {note(labels.drawing)}
            {block}
          </figure>
        }
      >
        <MermaidDiagram source={source} labels={{ drawing: labels.drawing, failed: labels.diagramFailed }}>
          {block}
        </MermaidDiagram>
      </Suspense>
    </DiagramBoundary>
  )
}

/** Keeps a document readable when the diagram code fails to load. */
class DiagramBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('could not load the diagram renderer', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

function DocLink({
  link,
  href,
  jump,
  children,
}: {
  link: MarkdownLink
  href: string
  jump: (id: string) => void
  children?: ReactNode
}) {
  if (link.kind === 'anchor')
    return (
      <a
        href={`#${link.id}`}
        onClick={e => {
          // The address holds the file, not a heading.
          e.preventDefault()
          jump(link.id)
        }}
      >
        {children}
      </a>
    )
  if (link.kind === 'external')
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  if (link.kind === 'internal')
    return (
      <a
        href={link.href}
        onClick={e => {
          if (!plain(e)) return
          e.preventDefault()
          link.open()
        }}
      >
        {children}
      </a>
    )
  return <span title={href}>{children}</span>
}
