// A Markdown document rendered as GitHub does (tables, task lists, highlighted code), with an
// outline of its headings. Raw HTML in it is dropped, so it runs nothing; what each link does is
// the caller's to say.

import '../highlight.css'
import './markdown.css'
import { type MouseEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { type Heading, headingsIn, Outline } from './outline'

/** How one link behaves: jump within the document, open in a new tab, open in the app, or nothing. */
export type MarkdownLink =
  | { kind: 'anchor'; id: string }
  | { kind: 'external' }
  /** Shown with `href`; a plain click calls `open`, a modified one is the browser's. */
  | { kind: 'internal'; href: string; open: () => void }
  | { kind: 'inert' }

export type MarkdownAppearance = { size: 's' | 'm' | 'l'; wide: boolean }

export type MarkdownLabels = { outline: string; image: (alt: string) => string }

// GitHub's heading ids, so the document's ids never shadow the page's own (a heading "Root").
const ID_PREFIX = 'user-content-'
const PROSE = { s: 'prose-sm', m: 'prose-base', l: 'prose-lg' }

type Props = {
  text: string
  appearance: MarkdownAppearance
  link: (href: string) => MarkdownLink
  labels: MarkdownLabels
  /** What scrolls the document, for the outline to follow. */
  scroller: HTMLElement | null
}

export function MarkdownRenderer({ text, appearance, link, labels, scroller }: Props) {
  const article = useRef<HTMLElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])

  // Parsing is the costly part; it is done again only when what it depends on changes.
  const rendered = useMemo(() => {
    // A hand-written '#install' names the heading GitHub gives the id 'user-content-install'.
    const jump = (id: string) =>
      [id, `${ID_PREFIX}${id}`]
        .map(at => article.current?.querySelector(`#${CSS.escape(at)}`))
        .find(Boolean)
        ?.scrollIntoView()
    const components: Components = {
      a: ({ href, children }) => (
        <DocLink link={link(href ?? '')} href={href ?? ''} jump={jump}>
          {children}
        </DocLink>
      ),
      img: ({ alt }) => <span className="text-faint">{labels.image(alt ?? '')}</span>,
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeSlug, { prefix: ID_PREFIX }],
          [rehypeHighlight, { detect: false }],
        ]}
        components={components}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    )
  }, [text, link, labels])

  // Read from the document as rendered. A renderer is mounted for one read of one file, so its
  // text stays as it was.
  useLayoutEffect(() => {
    if (article.current) setHeadings(headingsIn(article.current))
  }, [])

  return (
    <div className="flex justify-center gap-6 px-8">
      <article
        ref={article}
        className={`prose min-w-0 flex-1 py-6 ${PROSE[appearance.size]} ${appearance.wide ? 'max-w-none' : 'max-w-[78ch]'}`}
      >
        {rendered}
      </article>
      {headings.length > 1 ? (
        <Outline headings={headings} scroller={scroller} label={labels.outline} />
      ) : null}
    </div>
  )
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
