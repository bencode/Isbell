// A message an agent wrote, in Markdown as GitHub renders it (tables, task lists, highlighted code):
// set in the chat's own type, its code blocks copyable, its raw HTML dropped. What its links do, and
// how plain words become links (to the paths they name), is the caller's to say.

import { Check, Copy } from 'lucide-react'
import { Children, isValidElement, type ReactNode, useMemo, useState } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { MarkdownLink } from './blocks'
import { languages, PLAIN } from './languages'
import code from './markdown.module.scss'
import styles from './message.module.scss'

export type { MarkdownLink } from './blocks'
export type MessageLabels = { copy: string; copied: string }

const REHYPE: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false, languages, plainText: PLAIN }]]

/** The words in a node and those inside it, as they read. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

export function MessageMarkdown({
  text,
  link,
  words,
  labels,
}: {
  text: string
  link: (href: string) => MarkdownLink
  /** The plain words in a paragraph, list item, table cell or inline code, as they show. */
  words: (text: string) => ReactNode
  labels: MessageLabels
}) {
  const components = useMemo<Components>(() => {
    const inWords = (children: ReactNode) =>
      Children.map(children, child => (typeof child === 'string' ? words(child) : child))
    return {
      a: ({ href = '', children }) => (
        <MessageLink link={link(href)} href={href}>
          {children}
        </MessageLink>
      ),
      p: ({ children }) => <p>{inWords(children)}</p>,
      li: ({ children, className }) => <li className={className}>{inWords(children)}</li>,
      td: ({ children }) => <td>{inWords(children)}</td>,
      // A fence's code is highlighted and named by its language; code in a line reads as words.
      code: ({ className, children }) =>
        className ? <code className={className}>{children}</code> : <code>{inWords(children)}</code>,
      pre: ({ children }) => <CodeBlock labels={labels}>{children}</CodeBlock>,
      table: ({ children }) => (
        <div className={styles.table}>
          <table>{children}</table>
        </div>
      ),
      // Images an agent names are on its machine, not here: their words stand in.
      img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    }
  }, [link, words, labels])
  const rendered = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={REHYPE} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    ),
    [text, components],
  )
  return <div className={`${styles.message} ${code.reader}`}>{rendered}</div>
}

function MessageLink({ link, href, children }: { link: MarkdownLink; href: string; children: ReactNode }) {
  if (link.kind === 'external')
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  if (link.kind === 'internal')
    return (
      <a
        href={link.href}
        onClick={e => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          link.open()
        }}
      >
        {children}
      </a>
    )
  return <span>{children}</span>
}

function CodeBlock({ labels, children }: { labels: MessageLabels; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const inner = Children.toArray(children).find(isValidElement<{ className?: string }>)
  const language = /language-([\w+-]+)/.exec(inner?.props.className ?? '')?.[1]
  const copy = () =>
    navigator.clipboard.writeText(textOf(children).replace(/\n$/, '')).then(
      () => setCopied(true),
      (err: unknown) => console.error('could not copy', err),
    )
  return (
    <div className={styles.code}>
      <div className={styles.codeHead}>
        <span>{language ?? ''}</span>
        <button type="button" onClick={copy} onBlur={() => setCopied(false)} className={styles.copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}
