// A file share's link: `/share#<key>/<entry>`, the key a space of the share's own, the entry the
// file relative to the root its readers read under. All of it is after the #, so none of it reaches
// a server.

const HOUR_MS = 60 * 60 * 1000

export type Lasts = '1h' | '1d' | '7d'

export const LASTS: Record<Lasts, number> = { '1h': HOUR_MS, '1d': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS }

export const DEFAULT_LASTS: Lasts = '1d'

export const SHARE_PATH = '/share'

export const shareUrl = (origin: string, key: string, entry: string) =>
  `${origin}${SHARE_PATH}#${key}/${entry.split('/').map(encodeURIComponent).join('/')}`

/** What a share link's fragment holds; undefined for one that is not a share's. */
export function parseShareHash(hash: string): { key: string; entry: string } | undefined {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  const slash = fragment.indexOf('/')
  if (slash <= 0 || slash === fragment.length - 1) return undefined
  try {
    const entry = fragment
      .slice(slash + 1)
      .split('/')
      .map(decodeURIComponent)
      .join('/')
    return { key: fragment.slice(0, slash), entry }
  } catch (err) {
    console.warn('this share link is not valid', err)
    return undefined
  }
}
