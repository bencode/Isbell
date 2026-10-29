// What an agent is called: its name in herdr, which the CLI and the page both go by, or, without
// one, its kind and its pane. Renaming follows herdr's rule for names.

/** herdr's rule for an agent's name. */
export const NAME = /^[a-z][a-z0-9_-]{0,31}$/

const PANE = /^w([^:]+):p(\d+)$/

/** A pane id as short as it reads: 'w1A:p1' → '1A', 'w1A:p2' → '1A:2'; anything else as it is. */
export function shortPane(paneId: string) {
  const match = PANE.exec(paneId)
  if (!match) return paneId
  const [, workspace = '', pane] = match
  return pane === '1' ? workspace : `${workspace}:${pane}`
}

/** What an agent is called on the page: its herdr name, else its kind and short pane. */
export const shownName = (name: string | undefined, kind: string | undefined, paneId: string) =>
  name ?? `${kind ?? 'agent'} · ${shortPane(paneId)}`

/** Why `name` cannot be given (null: it can; '' clears the name). `taken`: the names of the other
 * live agents on the same machine. */
export function nameProblem(name: string, taken: string[]): 'format' | 'taken' | null {
  if (name === '') return null
  if (!NAME.test(name)) return 'format'
  return taken.includes(name) ? 'taken' : null
}
