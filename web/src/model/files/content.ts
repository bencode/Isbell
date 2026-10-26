// What a file holds, by its name and its bytes.

export type FileKind = 'markdown' | 'html' | 'mermaid' | 'text'

const KINDS: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  mmd: 'mermaid',
  mermaid: 'mermaid',
}

/** The lower-cased extension, or the whole lower-cased name when it has none (`Makefile`). */
export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(dot + 1) : name).toLowerCase()
}

export const kindOf = (name: string): FileKind => KINDS[extensionOf(name)] ?? 'text'

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** The bytes as text, or null when they are not text: a NUL byte, or not UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return utf8.decode(bytes)
  } catch (err) {
    if (err instanceof TypeError) return null
    throw err
  }
}

const UNITS = ['B', 'KB', 'MB', 'GB']

export function formatSize(bytes: number): string {
  const step = Math.min(UNITS.length - 1, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)))
  const value = bytes / 1024 ** step
  return `${step && value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[step]}`
}
