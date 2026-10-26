// A Markdown file rendered as GitHub does (tables, task lists, highlighted code), with its outline.
// Raw HTML in it is not rendered. A link to another file under the root opens it here.

import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Link } from 'react-router'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { useI18n } from '../../core/i18n'
import { useLocal } from '../../core/prefs'
import { resolveLink } from '../../model/files/paths'
import { type Heading, headingsIn, Outline } from './outline'

const PROSE = { s: 'prose-sm', m: 'prose-base', l: 'prose-lg' }

type Props = {
  text: string
  /** The file, relative to the root, which its links are relative to. */
  rel: string
  hrefOf: (rel: string) => string
  /** What scrolls the document, for the outline to follow. */
  scroller: HTMLElement | null
}

export function MarkdownView({ text, rel, hrefOf, scroller }: Props) {
  const t = useI18n()
  const { size, wide } = useLocal().layout.reader
  const article = useRef<HTMLElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])

  // Parsing is the costly part; it is done again only for a new text or a new place to link from.
  const rendered = useMemo(() => {
    const jump = (id: string) => article.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView()
    const components: Components = {
      a: ({ href, children }) => (
        <DocLink href={href ?? ''} rel={rel} hrefOf={hrefOf} jump={jump}>
          {children}
        </DocLink>
      ),
      img: ({ alt }) => <span className="text-faint">{t('files.image', { alt: alt ?? '' })}</span>,
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeHighlight, { detect: false }]]}
        components={components}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    )
  }, [text, rel, hrefOf, t])

  // Read from the document as rendered. A view is mounted for one read of one file, so its text
  // stays as it was.
  useLayoutEffect(() => {
    if (article.current) setHeadings(headingsIn(article.current))
  }, [])

  return (
    <div className="flex justify-center gap-6 px-8">
      <article
        ref={article}
        className={`prose min-w-0 flex-1 py-6 ${PROSE[size]} ${wide ? 'max-w-none' : 'max-w-[78ch]'}`}
      >
        {rendered}
      </article>
      {headings.length > 1 ? <Outline headings={headings} scroller={scroller} /> : null}
    </div>
  )
}

type DocLinkProps = {
  href: string
  rel: string
  hrefOf: (rel: string) => string
  jump: (id: string) => void
  children?: ReactNode
}

function DocLink({ href, rel, hrefOf, jump, children }: DocLinkProps) {
  const link = resolveLink(rel, href)
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
  if (link.kind === 'file') return <Link to={hrefOf(link.rel)}>{children}</Link>
  return <span title={href}>{children}</span>
}
