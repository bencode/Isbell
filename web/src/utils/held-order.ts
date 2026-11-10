// A list that stays put while the pointer is over it: what is shown keeps its place and its group
// until the pointer leaves, so that a row does not move from under it as what it shows changes.

import { useState } from 'react'

/** A row of a list, by its key, and the part of the list it is in. */
export type Slot<G> = { key: string; group: G }

/** `next` in the places `held` gave it: those still there where they were, then those new, each in
 * the group `next` puts it in. */
export function heldOrder<G>(held: readonly Slot<G>[], next: readonly Slot<G>[]): Slot<G>[] {
  const live = new Set(next.map(s => s.key))
  const kept = held.filter(s => live.has(s.key))
  const known = new Set(kept.map(s => s.key))
  return [...kept, ...next.filter(s => !known.has(s.key))]
}

/** `next` as it stood when `holding` began, until it ends; `release` takes it as it stands now, for
 * what is done to the list itself to show at once. */
export function useHeld<G>(next: Slot<G>[], holding: boolean) {
  const [held, setHeld] = useState<readonly Slot<G>[]>()
  // Kept from the render the hold began in, as React lets a component do with its own state.
  if (holding && !held) setHeld(next)
  if (!holding && held) setHeld(undefined)
  return { slots: holding && held ? heldOrder(held, next) : next, release: () => setHeld(undefined) }
}

/** The keys of the group, in order. */
export const keysIn = <G>(slots: readonly Slot<G>[], group: G) =>
  slots.filter(s => s.group === group).map(s => s.key)
