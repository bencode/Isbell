// A Markdown document to read, rendered as GitHub does (tables, task lists, highlighted code), with
// math and diagrams, in the reader's chosen appearance, and an outline of its headings. Raw HTML
// in it is dropped, so it runs nothing; what each link does, and where each image comes from, is the
// caller's to say.

import './markdown.css'
import { type CSSProperties, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { type ReadingAppearance, themeStyle } from './appearance'
import { blocks, type MarkdownLabels, type MarkdownLink } from './blocks'
import type { MarkdownImage } from './doc-image'
import { languages, PLAIN } from './languages'
import styles from './markdown.module.scss'
import { mathPlugins, mayHaveMath, normalizeMath } from './math'
import { type Heading, headingsIn, Outline, type OutlineLayout } from './outline'

export type { MarkdownLabels, MarkdownLink } from './blocks'
export type { MarkdownImage } from './doc-image'
export type { OutlineLayout } from './outline'

// GitHub's heading ids, so the document's ids never shadow the page's own (a heading "Root").
const ID_PREFIX = 'user-content-'
/** Narrower than this, the outline goes over the document rather than beside it. */
const BESIDE_MIN_PX = 640
const SERIF = '"Iowan Old Style", Charter, "Source Han Serif SC", "Songti SC", Georgia, serif'

type Props = {
  text: string
  appearance: ReadingAppearance
  link: (href: string) => MarkdownLink
  image: (src: string) => MarkdownImage
  labels: MarkdownLabels
  outline: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Hears whether there are headings enough for an outline, and where it would go. */
    onState: (state: { available: boolean; layout: OutlineLayout }) => void
  }
  /** Where the document is scrolled to each time it shows, and where it has been scrolled to. */
  scroll: { at: () => number; onScroll: (top: number) => void }
}

export function MarkdownRenderer({ text, appearance, link, image, labels, outline, scroll }: Props) {
  // Waits, under the caller's Suspense, for the math plugins when the text may have math.
  const math = mayHaveMath(text) ? use(mathPlugins()) : undefined
  const root = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [width, setWidth] = useState(0)
  const layout: OutlineLayout = width >= BESIDE_MIN_PX ? 'beside' : 'over'
  const startAt = useRef(scroll.at)
  const { onState, onOpenChange } = outline

  // Parsing is the costly part; it is done again only when what it depends on changes.
  const rendered = useMemo(() => {
    // A hand-written '#install' names the heading GitHub gives the id 'user-content-install'.
    const jump = (id: string) =>
      [id, `${ID_PREFIX}${id}`]
        .map(at => article.current?.querySelector(`#${CSS.escape(at)}`))
        .find(Boolean)
        ?.scrollIntoView()
    const rehype: Options['rehypePlugins'] = [
      [rehypeSlug, { prefix: ID_PREFIX }],
      ...(math ? [math.rehype] : []),
      [rehypeHighlight, { detect: false, languages, plainText: PLAIN }],
    ]
    return (
      <ReactMarkdown
        remarkPlugins={math ? [remarkGfm, math.remark] : [remarkGfm]}
        rehypePlugins={rehype}
        components={blocks({ link, image, labels, jump })}
        skipHtml
      >
        {math ? normalizeMath(text) : text}
      </ReactMarkdown>
    )
  }, [text, math, link, image, labels])

  // Read from the document as rendered. A renderer is mounted for one read of one file, so its
  // text stays as it was.
  useLayoutEffect(() => {
    if (article.current) setHeadings(headingsIn(article.current))
  }, [])

  // Back where this history entry was last read, each time it shows; the document is there to
  // scroll to.
  useLayoutEffect(() => {
    if (scroller) scroller.scrollTop = startAt.current()
  }, [scroller])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => onState({ available: headings.length > 1, layout }), [headings, layout, onState])

  const style = {
    ...themeStyle(appearance.theme),
    '--reader-font-size': `${appearance.fontSize}px`,
    '--reader-font': appearance.font === 'serif' ? SERIF : 'var(--font-sans)',
  } as CSSProperties
  return (
    <div
      ref={root}
      data-reading-width={appearance.width}
      style={style}
      className={`${styles.reader} relative flex min-h-0 flex-1 bg-bg text-text`}
    >
      <div
        ref={setScroller}
        className={`${styles.scroll} min-w-0 flex-1 overflow-auto`}
        onScroll={e => scroll.onScroll(e.currentTarget.scrollTop)}
      >
        <article ref={article} className="prose">
          {rendered}
        </article>
      </div>
      {outline.open && headings.length > 1 ? (
        <Outline
          headings={headings}
          scroller={scroller}
          layout={layout}
          labels={{ outline: labels.outline, close: labels.closeOutline }}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </div>
  )
}
