// Files on a machine as the views need them: a folder's listing, a search and a file, each loaded
// once for what it is asked about, and a view that wants them again is mounted afresh (keyed); or a
// file kept up to date for a preview, read again as it shows again.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type FileRead,
  type Found,
  type Listing,
  list,
  PREVIEW_MAX,
  read,
  search,
} from '../model/files/remote'
import { useSpace } from './space'

type Loaded<T> = { data?: T; error?: unknown }

/** What `load` gives; a new `load` (its inputs changed) starts over. What was loaded is kept with
 * the load it came from, so a view hidden and shown again (an Activity) keeps it instead of reading
 * it again. */
function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [{ by, ...loaded }, setLoaded] = useState<Loaded<T> & { by?: () => Promise<T> }>({})
  const done = by === load
  useEffect(() => {
    if (done) return
    let live = true
    load().then(
      data => live && setLoaded({ data, by: load }),
      (error: unknown) => live && setLoaded({ error, by: load }),
    )
    return () => {
      live = false
    }
  }, [load, done])
  return done ? loaded : {}
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

type Fresh = Loaded<FileRead> & {
  /** Reads it again now. */
  again: () => void
  /** A read asked for by `again` is on its way. */
  reading: boolean
}

/** The file at `path` for a preview kept while hidden (an Activity): read when it shows, each time it
 * shows again, and on `again`. A read that finds the file as it was sends none of it and leaves what
 * is held; one that fails keeps what was read, beside the error. */
export function useFreshFile(mid: string, path: string): Fresh {
  const { openStream } = useSpace()
  const load = useCallback(
    (previous?: FileRead) => read(openStream, mid, path, PREVIEW_MAX, {}, previous),
    [openStream, mid, path],
  )
  type Held = Loaded<FileRead> & { by?: typeof load }
  const [{ by, ...loaded }, setHeld] = useState<Held>({})
  const [reading, setReading] = useState(false)
  // The last file read, to read against; written as reads come back.
  const last = useRef<{ by: typeof load; data: FileRead }>(null)

  /** Reads against what was read last; what comes back is kept while `live` says so. */
  const fetch = useCallback(
    (live: () => boolean) => {
      const previous = last.current?.by === load ? last.current.data : undefined
      return load(previous).then(
        data => {
          last.current = { by: load, data }
          if (live()) setHeld({ data, by: load })
        },
        (error: unknown) => {
          if (live()) setHeld(held => ({ ...(held.by === load ? held : {}), error, by: load }))
        },
      )
    },
    [load],
  )
  // Effects run again each time an Activity shows what it hid.
  useEffect(() => {
    let live = true
    void fetch(() => live)
    return () => {
      live = false
    }
  }, [fetch])

  const again = () => {
    setReading(true)
    void fetch(() => true).finally(() => setReading(false))
  }
  return { ...(by === load ? loaded : {}), again, reading }
}
