// A text file as source: line numbers, and highlighting when its name says which language it is.

import '../highlight.css'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { common, createLowlight } from 'lowlight'
import { useMemo } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { extensionOf } from '../../../model/files/content'

const lowlight = createLowlight(common)

/** Past this, highlighting would hold the page up; the text shows plain. */
const HIGHLIGHT_MAX = 512 << 10

export function CodeRenderer({ text, name }: { text: string; name: string }) {
  const lang = extensionOf(name)
  const code = useMemo(
    () =>
      text.length <= HIGHLIGHT_MAX && lowlight.registered(lang)
        ? toJsxRuntime(lowlight.highlight(lang, text), { Fragment, jsx, jsxs })
        : text,
    [lang, text],
  )
  // A last newline ends the last line rather than starting another.
  const lines = text.replace(/\n$/, '').split('\n').length
  return (
    <div className="flex min-w-max font-mono text-[12.5px] leading-[1.6]">
      <pre
        aria-hidden
        className="m-0 flex-none border-r border-line px-3 py-4 text-right text-faint select-none"
      >
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      <pre className="m-0 px-4 py-4">
        <code className="hljs">{code}</code>
      </pre>
    </div>
  )
}
