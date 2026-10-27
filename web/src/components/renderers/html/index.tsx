// An HTML page, such as a design draft, run on an origin of its own: it cannot reach the page around
// it, its storage, or the space key in it, yet it runs as if a static server held its project. The
// preview origin's worker asks for every file the page loads, and this answers each with `read`; the
// page and its files reach the browser untouched.

import { useEffect, useRef, useState } from 'react'
import { CallError } from '../../../model/streams'

/** Where pages run, apart from the app. */
export const PREVIEW_ORIGIN: string =
  import.meta.env.VITE_PREVIEW_ORIGIN ??
  (import.meta.env.DEV ? 'http://localhost:5174' : 'https://isbell-preview.fmap.dev')

type Read = (rel: string) => Promise<Blob>

type Props = {
  /** The page, relative to the root that `read` reads under. */
  entry: string
  title: string
  read: Read
}

export function HtmlRenderer({ entry, title, read }: Props) {
  // Only this preview's bridge can ask for its files.
  const [token] = useState(() => crypto.randomUUID())
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const listener = (e: MessageEvent) => {
      const bridge = frame.current?.contentWindow
      if (bridge && e.source === bridge) void answer(e, bridge, read)
    }
    addEventListener('message', listener)
    return () => removeEventListener('message', listener)
  }, [read])

  return (
    <iframe
      ref={frame}
      title={title}
      // Its own origin, so same-origin gives it nothing of the app's; never the top navigation.
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
      referrerPolicy="no-referrer"
      src={hostOf(token, entry)}
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  )
}

const hostOf = (token: string, entry: string) =>
  `${PREVIEW_ORIGIN}/host.html?t=${token}&open=${encodeURIComponent(entry)}`

/** Answers `bridge` asking for a file in `e`, with what `read` reads. */
async function answer(e: MessageEvent, bridge: Window, read: Read) {
  if (e.origin !== PREVIEW_ORIGIN || e.data?.isbell !== 'read') return
  const { id, rel } = e.data as { id: number; rel: string }
  const file = await served(read, rel)
  bridge.postMessage({ isbell: 'file', id, ...file }, PREVIEW_ORIGIN, file.bytes ? [file.bytes] : [])
}

type Served = { status: number; type?: string; bytes?: ArrayBuffer }

/** The file at `rel` as an answer for the worker: its bytes, or why there are none. */
async function served(read: Read, rel: string): Promise<Served> {
  // The browser settles '..' in a URL, but not '..%2F', which the worker decodes into a climb out of
  // the root; and the gateway reads any path it is given.
  if (rel.split('/').includes('..')) return { status: 404 }
  try {
    const blob = await read(rel)
    return { status: 200, type: blob.type, bytes: await blob.arrayBuffer() }
  } catch (err) {
    if (err instanceof CallError && ['not_found', 'not_a_directory'].includes(err.code))
      return { status: 404 }
    if (err instanceof CallError && err.code === 'too_large') return { status: 413 }
    console.warn('could not read a file for the page', rel, err)
    return { status: 502 }
  }
}
