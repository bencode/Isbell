// A project's files as the views need them: a folder's listing, a search and a file, each loaded
// once for what it is asked about. A view that wants them again is mounted afresh (keyed).

import { useCallback, useEffect, useState } from 'react'
import { useSpace } from '../../core/space'
import {
  type FileRead,
  type Found,
  type Listing,
  list,
  PREVIEW_MAX,
  read,
  search,
} from '../../model/files/remote'

export type Loaded<T> = { data?: T; error?: unknown }

/** What `load` gives; a new `load` (its inputs changed) starts over. */
function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({})
  useEffect(() => {
    let live = true
    setLoaded({})
    load().then(
      data => live && setLoaded({ data }),
      (error: unknown) => live && setLoaded({ error }),
    )
    return () => {
      live = false
    }
  }, [load])
  return loaded
}

export function useListing(mid: string, path: string): Loaded<Listing> {
  const { call } = useSpace()
  return useLoaded(useCallback(() => list(call, mid, path), [call, mid, path]))
}

export function useSearch(mid: string, root: string, query: string): Loaded<Found> {
  const { call } = useSpace()
  return useLoaded(useCallback(() => search(call, mid, root, query), [call, mid, root, query]))
}

/** The file at `path` for its preview: its bytes, unless it is over PREVIEW_MAX. */
export function useFile(mid: string, path: string): Loaded<FileRead> {
  const { openStream } = useSpace()
  return useLoaded(useCallback(() => read(openStream, mid, path, PREVIEW_MAX), [openStream, mid, path]))
}
