// An image in a document: from the web as it is, read for it by the caller, or a placeholder for
// one it cannot show (and while it is being read).

import { useEffect, useState } from 'react'
import { useObjectUrl } from '../../../utils/object-url'

/** How one image in a document shows: from the web, read by the caller, or as a placeholder. */
export type MarkdownImage =
  | { kind: 'url'; url: string }
  | { kind: 'load'; load: () => Promise<Blob> }
  | { kind: 'none' }

type Props = { image: MarkdownImage; alt: string; placeholder: string }

export function DocImage({ image, alt, placeholder }: Props) {
  const load = image.kind === 'load' ? image.load : undefined
  const [blob, setBlob] = useState<Blob>()
  const [broken, setBroken] = useState(false)
  const read = useObjectUrl(blob)
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(
      got => live && setBlob(got),
      (err: unknown) => {
        console.warn('could not read an image in the document', err)
        if (live) setBroken(true)
      },
    )
    return () => {
      live = false
    }
  }, [load])
  const src = image.kind === 'url' ? image.url : read
  if (broken || !src) return <span className="text-faint">{placeholder}</span>
  return (
    <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
  )
}
