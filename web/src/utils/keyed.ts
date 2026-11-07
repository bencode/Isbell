/** React keys for a list, from its items' content, numbered where the content repeats. */
export function keyed<T>(items: T[], keyOf: (item: T) => string): [string, T][] {
  const seen = new Map<string, number>()
  return items.map(item => {
    const k = keyOf(item)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return [`${n}:${k}`, item]
  })
}
