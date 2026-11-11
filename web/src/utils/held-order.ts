// The row being looked at stays where it was when it was opened: opening it may change it (a
// finished session is marked seen), and it should not move from under the pointer that opened it.
// The other rows move as they change.

import { useState } from 'react'

/** A row of a list, by its key, and the part of the list it is in. */
export type Slot<G> = { key: string; group: G }

/** Where a row was when it was opened: its part of the list, and its place among that part's rows. */
export type Pin<G> = { key: string; group: G; index: number }

/** `next`, with the pinned row put back in its part and place, if it is still there. */
export function pinIn<G>(next: readonly Slot<G>[], pin: Pin<G>): Slot<G>[] {
  if (!next.some(s => s.key === pin.key)) return [...next]
  const rest = next.filter(s => s.key !== pin.key)
  const inGroup = rest.flatMap((s, i) => (s.group === pin.group ? [i] : []))
  const at = inGroup[pin.index] ?? (inGroup.at(-1) ?? rest.length - 1) + 1
  return [...rest.slice(0, at), { key: pin.key, group: pin.group }, ...rest.slice(at)]
}

/** `next`, with the row `opened` kept where it was when it was opened, until another is. */
export function usePinned<G>(next: Slot<G>[], opened: string | undefined): Slot<G>[] {
  const [pin, setPin] = useState<{ key: string | undefined; at?: Pin<G> }>({ key: undefined })
  // Taken in the render the row is opened in, as React lets a component do with its own state.
  if (pin.key !== opened) {
    const found = next.find(s => s.key === opened)
    const index = found ? next.filter(s => s.group === found.group).indexOf(found) : -1
    setPin(
      found && opened ? { key: opened, at: { key: opened, group: found.group, index } } : { key: opened },
    )
  }
  return pin.key === opened && pin.at ? pinIn(next, pin.at) : next
}

/** The keys of the group, in order. */
export const keysIn = <G>(slots: readonly Slot<G>[], group: G) =>
  slots.filter(s => s.group === group).map(s => s.key)
