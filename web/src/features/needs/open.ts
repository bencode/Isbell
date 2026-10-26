// Which row of Needs you is open. Answering takes a row out of the list; the row that takes its
// place opens, so the list can be worked through without picking each one.

/** A row by its `paneKey`, and where it stood when it was last seen open. */
export type Open = { key: string; at: number }

/** Nothing picked yet: the row in the first place opens, so the list is ready to answer. */
export const FIRST: Open = { key: '', at: 0 }

/** The row to show open: the one opened, or, once it has left, the one that took its place. */
export function follow(keys: string[], open: Open | null): Open | null {
  if (!open) return null
  const at = keys.indexOf(open.key)
  if (at >= 0) return { key: open.key, at }
  const next = Math.min(open.at, keys.length - 1)
  const key = keys[next]
  return key === undefined ? null : { key, at: next }
}
