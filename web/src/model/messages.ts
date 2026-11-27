// What agents tell the user on a machine (`isbell message`, crates/isbell/src/book/messages.rs): one
// message a matter, followed up with replies, its kind telling whether it still asks for them; the
// latest active first. Read only here.

export const messagesPath = '~/.isbell/messages.json'

const VERSION = 1

export type MessageKind = 'ask' | 'warn' | 'done' | 'info'

/** The oldest first; `role`, the replier's when it had one. */
export type Reply = { time: number; text: string; role?: string }

/** The agent session that sent a message, and its role then. */
export type Sender = { agent: string; session: string; role?: string; dir: string }

export type Message = {
  id: number
  /** Milliseconds since the epoch. */
  time: number
  kind: MessageKind
  title?: string
  text?: string
  /** What it is about: `session:<agent>:<id>`, `file:<path>` or `project:<path>`. */
  link?: string
  task?: number
  from?: Sender
  replies: Reply[]
}

/** What the page reads of the file. */
export type Messages = { messages: Message[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const optional = (value: unknown, type: 'string' | 'number') => value === undefined || typeof value === type

const isSender = (v: unknown) =>
  isObject(v) &&
  typeof v.agent === 'string' &&
  typeof v.session === 'string' &&
  optional(v.role, 'string') &&
  typeof v.dir === 'string'

const isReply = (v: unknown) =>
  isObject(v) && typeof v.time === 'number' && typeof v.text === 'string' && optional(v.role, 'string')

const isMessage = (v: unknown) =>
  isObject(v) &&
  typeof v.id === 'number' &&
  typeof v.time === 'number' &&
  ['ask', 'warn', 'done', 'info'].includes(v.kind as string) &&
  ['title', 'text', 'link'].every(k => optional(v[k], 'string')) &&
  optional(v.task, 'number') &&
  (v.from === undefined || isSender(v.from)) &&
  (v.replies === undefined || (Array.isArray(v.replies) && v.replies.every(isReply)))

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

/** The messages `text` holds; undefined when it is no such file. */
export function parseMessages(text: string): Messages | undefined {
  const file = parsed(text)
  const ok =
    isObject(file) &&
    file.version === VERSION &&
    Array.isArray(file.messages) &&
    file.messages.every(isMessage)
  if (!ok) return undefined
  const messages = (file.messages as (Omit<Message, 'replies'> & { replies?: Reply[] })[]).map(m => ({
    ...m,
    replies: m.replies ?? [],
  }))
  return { messages }
}

/** When it was last active: its latest reply, or when it was sent. */
export const lastActive = (m: Message) => m.replies.at(-1)?.time ?? m.time

/** Whether it waits on the user: a question, or a warning. */
export const asksYou = (m: Message) => m.kind === 'ask' || m.kind === 'warn'

/** The messages of every machine as one list, the latest active first. */
export const feed = <T extends { message: Message }>(items: T[]): T[] =>
  [...items].sort((a, b) => lastActive(b.message) - lastActive(a.message))

export type Link = { kind: 'session'; agent: string; id: string } | { kind: 'file' | 'project'; path: string }

/** A message's link, as `check_link` lets it be; undefined when it is none of them. */
export function parseLink(link: string): Link | undefined {
  const [kind, ...parts] = link.split(':')
  const rest = parts.join(':')
  if (kind === 'file' || kind === 'project') return rest.startsWith('/') ? { kind, path: rest } : undefined
  const [agent, ...id] = parts
  return kind === 'session' && agent && id.join(':') ? { kind, agent, id: id.join(':') } : undefined
}
