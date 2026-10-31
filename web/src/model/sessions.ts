// The sessions a machine's agents have had, as Isbell's agent hook (integrations/agent-hook.sh)
// records them under the machine's ~/.isbell/sessions: the projects they ran in, each project's
// latest, and every one by the month it began. A session is resumed from its record, in a new pane
// in the directory it ran in.

/** A session as last recorded: what it was first and last asked, in milliseconds since the epoch. */
export type SessionRecord = {
  agent: string
  id: string
  cwd: string
  first: string
  last: string
  started: number
  updated: number
}

/** A session as recorded when it began, in its month's list. */
export type MonthLine = Omit<SessionRecord, 'last' | 'updated'>

/** Every project a session ran in, by its root: where the project's records are, and when one of
 * them last changed. */
export type Roots = Readonly<Record<string, { key: string; updated: number }>>

export const STORE = '~/.isbell/sessions'
export const rootsPath = `${STORE}/roots.json`
/** The project's latest sessions, the last active first. */
export const recentPath = (key: string) => `${STORE}/${key}/recent.json`
export const monthsDir = (key: string) => `${STORE}/${key}/months`
/** `month` as the file is named: YYYY-MM. */
export const monthPath = (key: string, month: string) => `${monthsDir(key)}/${month}.jsonl`

const isText = (v: unknown): v is string => typeof v === 'string'
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isLine = (v: unknown): v is MonthLine => {
  const s = v as Partial<MonthLine> | null
  return isText(s?.agent) && isText(s.id) && isText(s.cwd) && isText(s.first) && isTime(s.started)
}

const isRecord = (v: unknown): v is SessionRecord => {
  const s = v as Partial<SessionRecord> | null
  return isText(s?.last) && isTime(s?.updated) && isLine(s)
}

/** Text that may not be JSON, as a file the hook writes can be cut short by a full disk. */
const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    console.warn('ignoring an unreadable session record', err)
    return undefined
  }
}

export function parseRoots(text: string): Roots {
  const found = json(text)
  if (typeof found !== 'object' || found === null) return {}
  return Object.fromEntries(
    Object.entries(found).filter(([root, value]) => {
      const at = value as { key?: unknown; updated?: unknown } | null
      return root.startsWith('/') && isText(at?.key) && at.key !== '' && isTime(at.updated)
    }),
  )
}

export function parseRecent(text: string): SessionRecord[] {
  const found = json(text)
  return Array.isArray(found) ? found.filter(isRecord) : []
}

/** The sessions begun in a month, the latest first; a line cut short is passed over. */
export const parseMonth = (text: string): MonthLine[] =>
  text
    .split('\n')
    .filter(line => line.trim())
    .map(json)
    .filter(isLine)
    .sort((a, b) => b.started - a.started)

/** How the agent resumes the session, after its own command; none for an agent Isbell cannot. */
export const resumeArgs = (agent: string, id: string): string[] | undefined =>
  agent === 'claude' ? ['--resume', id] : agent === 'codex' ? ['resume', id] : undefined

const two = (n: number) => String(n).padStart(2, '0')

/** The local day of `ms`, as YYYY-MM-DD, by which sessions are grouped. */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
