// A Blob as a URL an <img> can show, for as long as it is shown.

import { useEffect, useState } from 'react'

/** An object URL for `blob`, revoked when the blob changes or the caller unmounts. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    const made = URL.createObjectURL(blob)
    setUrl({ blob, url: made })
    return () => URL.revokeObjectURL(made)
  }, [blob])
  // Until the effect runs for a new blob, the old URL is not this blob's.
  return blob && url?.blob === blob ? url.url : undefined
}
