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
  /** The file the agent keeps the conversation in, once the hook (v5) has told it. */
  transcript?: string
  /** The command it was started with, where that was a template's own (hook v6), which resumes it. */
  launch?: string
}

/** A session as recorded when it began, in its month's list. */
export type MonthLine = Omit<SessionRecord, 'last' | 'updated' | 'transcript'>

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

const OPENED = '<pasted_content id="'
const CLOSED = '</pasted_content id="'
const PASTE_MARK = /\s*<\/?pasted_content id="[^"]*">\s*/g

/** What was said, without the marks wrapped around pasted text. The hook keeps the first 200
 * characters, which can cut the closing mark short. */
function withoutPasteMarks(text: string): string {
  if (!text.includes(OPENED)) return text
  const clean = text.replace(PASTE_MARK, ' ')
  const at = clean.lastIndexOf('<')
  const tail = clean.slice(at)
  const cut = at >= 0 && (CLOSED.startsWith(tail) || (tail.startsWith(CLOSED) && !tail.includes('>')))
  return (cut ? clean.slice(0, at) : clean).trim()
}

const isText = (v: unknown): v is string => typeof v === 'string'
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isLine = (v: unknown): v is MonthLine => {
  const s = v as Partial<MonthLine> | null
  return (
    isText(s?.agent) &&
    isText(s.id) &&
    isText(s.cwd) &&
    isText(s.first) &&
    isTime(s.started) &&
    (s.launch === undefined || isText(s.launch))
  )
}

const isRecord = (v: unknown): v is SessionRecord => {
  const s = v as Partial<SessionRecord> | null
  return (
    isText(s?.last) && isTime(s?.updated) && (s.transcript === undefined || isText(s.transcript)) && isLine(s)
  )
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
  return Array.isArray(found)
    ? found
        .filter(isRecord)
        .map(s => ({ ...s, first: withoutPasteMarks(s.first), last: withoutPasteMarks(s.last) }))
    : []
}

/** The sessions begun in a month, the latest first; a line cut short is passed over. */
export const parseMonth = (text: string): MonthLine[] =>
  text
    .split('\n')
    .filter(line => line.trim())
    .map(json)
    .filter(isLine)
    .map(s => ({ ...s, first: withoutPasteMarks(s.first) }))
    .sort((a, b) => b.started - a.started)

const RESUME = new Map<string, (id: string) => string[]>([
  ['claude', id => ['--resume', id]],
  ['codex', id => ['resume', id]],
  // Resumed into the chat, pi runs in its regular mode, which leaves the conversation for it to read.
  ['pi', id => ['--tui-mode', 'regular', '--session', id]],
])

/** How the agent resumes the session, after its own command; none for an agent Isbell cannot. */
export const resumeArgs = (agent: string, id: string): string[] | undefined => RESUME.get(agent)?.(id)

/** Where each agent keeps its sessions unless told otherwise. */
const OWN_SESSIONS = new Map([
  ['claude', '/.claude/projects/'],
  ['codex', '/.codex/sessions/'],
  ['pi', '/.pi/agent/sessions/'],
])

/** Started outside Isbell with the agent keeping its sessions elsewhere (another config dir, as a
 * wrapper like `rec` sets): resumed by the agent's plain command, it may not find the session. As
 * `keptElsewhere` in ios/IsbellKit/Sources/IsbellKit/SessionRecords.swift. */
export const keptElsewhere = (s: { agent: string; transcript?: string; launch?: string }): boolean => {
  const own = OWN_SESSIONS.get(s.agent)
  return (
    s.launch === undefined && s.transcript !== undefined && own !== undefined && !s.transcript.includes(own)
  )
}

const two = (n: number) => String(n).padStart(2, '0')

/** The local day of `ms`, as YYYY-MM-DD, by which sessions are grouped. */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** A session in a list: as the project's latest keep it, or only as its month's line. */
export type SessionLine = MonthLine & { last?: string; updated?: number; transcript?: string }

/** What names a session among every agent's. */
export const sessionKey = (s: { agent: string; id: string }) => `${s.agent}/${s.id}`

/** Where some of a project's records are kept; `only`: of them, those that ran under it, as the
 * project is a directory inside the repository they are recorded for. */
export type RecordSource = { key: string; only?: string }

/** Whether `dir` is `top` or below it. */
export const under = (dir: string, top: string) => dir === top || dir.startsWith(`${top}/`)

/** The roots recorded where a project's sessions may be: itself and below it, each of its worktrees
 * and below, and a repository it is inside of. */
export const recordSources = (roots: Roots, path: string, worktrees: readonly string[]): RecordSource[] =>
  Object.entries(roots).flatMap(([root, { key }]): RecordSource[] => {
    if ([path, ...worktrees].some(dir => under(root, dir))) return [{ key }]
    return under(path, root) ? [{ key, only: path }] : []
  })

/** Whether a session the source holds belongs to the project. */
export const within = (source: RecordSource, cwd: string) =>
  source.only === undefined || under(cwd, source.only)

/** The lists as one, each session once as it was last updated, the last active first. */
export function mergeRecent(lists: SessionRecord[][]): SessionRecord[] {
  const latest = new Map<string, SessionRecord>()
  for (const s of lists.flat()) {
    const was = latest.get(sessionKey(s))
    if (!was || was.updated < s.updated) latest.set(sessionKey(s), s)
  }
  return [...latest.values()].sort((a, b) => b.updated - a.updated)
}

/**
 * The codex session a pane runs when its hook cannot say (a codex served by its shared daemon): of
 * the latest, the one last active in the pane's directory since its codex started, that no other
 * pane is known to run. The hook records such sessions all the same, on the machine's clock.
 */
export const codexRecordFor = (
  latest: readonly SessionRecord[],
  cwd: string,
  since: number,
  claimed: ReadonlySet<string>,
): string | undefined =>
  latest
    .filter(s => s.agent === 'codex' && s.cwd === cwd && s.updated >= since && !claimed.has(s.id))
    .reduce<SessionRecord | undefined>((last, s) => (last && last.updated >= s.updated ? last : s), undefined)
    ?.id

/** Where the session of the codex in `pane` may be guessed: its directory, unless another codex
 * works there, whose session could be taken for it. */
export const guessDir = (
  agents: readonly { paneId: string; kind?: string; cwd?: string }[],
  pane: { paneId: string; kind?: string; cwd?: string },
) =>
  pane.kind === 'codex' &&
  pane.cwd &&
  !agents.some(a => a.paneId !== pane.paneId && a.kind === 'codex' && a.cwd === pane.cwd)
    ? pane.cwd
    : undefined

/** Months' lines as one, each session once, leaving out those `seen`, the latest begun first. */
export const mergeMonths = (lists: MonthLine[][], seen: ReadonlySet<string>): MonthLine[] =>
  [...new Map(lists.flat().map(s => [sessionKey(s), s])).values()]
    .filter(s => !seen.has(sessionKey(s)))
    .sort((a, b) => b.started - a.started)

/** When a session was last seen active. */
export const lineTime = (s: SessionLine) => s.updated ?? s.started

/** Whether what the session was asked, or where it ran, holds `needle` (lower case). */
export const matches = (s: SessionLine, needle: string) =>
  [s.first, s.last ?? '', s.cwd].some(text => text.toLowerCase().includes(needle))

const BEFORE_MATCH = 10

/** `text` from just before `needle` (lower case), so that a row as wide as it is shows the match. */
export function excerpt(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle)
  return at <= BEFORE_MATCH ? text : `…${text.slice(at - BEFORE_MATCH)}`
}

/** The items in the order given, in runs of one local day. */
export const byDay = <T>(items: T[], at: (item: T) => number): [T, ...T[]][] =>
  items.reduce<[T, ...T[]][]>((days, item) => {
    const today = days.at(-1)
    if (today && dayKey(at(today[0])) === dayKey(at(item))) today.push(item)
    else days.push([item])
    return days
  }, [])

/** The stretch of time a list puts a session under: the day, the day before, the rest of the week
 * (from Monday), or else its month. */
export type Period = { kind: 'today' | 'yesterday' | 'week' } | { kind: 'month'; year: number; month: number }

const dayStart = (ms: number, back = 0) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - back)
  return d.getTime()
}

/** The period `ms` falls in, as seen at `now`. */
export function periodOf(ms: number, now: number): Period {
  if (ms >= dayStart(now)) return { kind: 'today' }
  if (ms >= dayStart(now, 1)) return { kind: 'yesterday' }
  // Days since Monday: getDay() counts from Sunday.
  if (ms >= dayStart(now, (new Date(now).getDay() + 6) % 7)) return { kind: 'week' }
  const d = new Date(ms)
  return { kind: 'month', year: d.getFullYear(), month: d.getMonth() }
}

const periodKey = (p: Period) => (p.kind === 'month' ? `${p.year}-${p.month}` : p.kind)

/** The items in the order given, in runs of one period. */
export const byPeriod = <T>(items: T[], at: (item: T) => number, now: number) =>
  items.reduce<{ period: Period; items: [T, ...T[]] }[]>((runs, item) => {
    const period = periodOf(at(item), now)
    const last = runs.at(-1)
    if (last && periodKey(last.period) === periodKey(period)) last.items.push(item)
    else runs.push({ period, items: [item] })
    return runs
  }, [])
