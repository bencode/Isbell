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

const MEDIA: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  // With a charset, so a page with no <meta charset> does not read as Latin-1.
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  // A module script loads only with a JavaScript type.
  js: 'text/javascript;charset=utf-8',
  mjs: 'text/javascript;charset=utf-8',
  json: 'application/json',
  txt: 'text/plain;charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
}

/** The media type a file is served with, by its name; undefined lets the browser sniff. */
export const mediaType = (name: string): string | undefined => MEDIA[extensionOf(name)]

/** The media type of an image file by its name, or undefined when it is not one. An SVG shows in
 * `<img>` only when its Blob says so. */
export const imageType = (name: string): string | undefined => {
  const type = mediaType(name)
  return type?.startsWith('image/') ? type : undefined
}

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
