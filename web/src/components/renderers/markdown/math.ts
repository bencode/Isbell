// remark-math renders display math as a block only when its `$$` fences stand on their own lines,
// and knows nothing of LaTeX's `\[…\]` and `\(…\)`. Agents write all of these, so each is rewritten
// into the form remark-math reads. Code is split out first and kept as written, so a regex with
// `\(` in it is never touched.

// Fenced and inline code, captured, so splitting keeps it at the odd indices.
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g

/** Display math as a `$$` block of its own. */
const fence = (math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`

const rewrite = (prose: string) =>
  prose
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => fence(math))
    .replace(/\$\$([^\n]+?)\$\$/g, (_, math: string) => fence(math))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`)

export const normalizeMath = (text: string) =>
  text
    .split(CODE)
    .map((part, i) => (i % 2 === 0 ? rewrite(part) : part))
    .join('')

export type MathPlugins = {
  remark: typeof import('remark-math').default
  rehype: typeof import('rehype-katex').default
}

let loading: Promise<MathPlugins> | undefined

/** The math plugins and KaTeX's styles, fetched the first time a document has math. */
export const mathPlugins = () => {
  loading ??= Promise.all([
    import('remark-math'),
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([remark, rehype]) => ({ remark: remark.default, rehype: rehype.default }))
  return loading
}

/** Whether `text` may hold math: anything with a `$`, `\(` or `\[`. A false alarm only costs the
 * fetch. */
export const mayHaveMath = (text: string) => /\$|\\\(|\\\[/.test(text)
