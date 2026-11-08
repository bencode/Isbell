// A session's conversation as the agent recorded it, read into turns: what was asked, then what
// the agent said, thought and did, in order.

export type ToolItem = {
  kind: 'tool'
  id: string
  /** By Claude Code's names (Bash, Read, Edit, …), whichever agent ran it. */
  name: string
  target: string
  output?: string
  error: boolean
  /** Lines an edit added and removed. */
  edit?: { add: number; del: number }
  /** Its result is in. */
  done: boolean
}

export type ChatItem =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; ms?: number }
  | ToolItem
  | { kind: 'note'; note: 'interrupted' | 'failed' | 'compacted'; text?: string }

/** What was asked: its words, the images sent along by path, and those sent as data URLs. */
export type Asked = { text: string; images: string[]; data: string[] }

export type ChatTurn = {
  id: string
  /** Absent for what came before the first question. */
  you?: Asked
  at: number
  took?: number
  model?: string
  items: ChatItem[]
}

/** What each agent's record is read into, in its order, before it is told into turns. */
export type Entry =
  | { kind: 'you'; id: string; at: number; you: Asked }
  | { kind: 'item'; at: number; item: ChatItem }
  | { kind: 'result'; id: string; output: string; error: boolean }
  | { kind: 'end'; took?: number }
  | { kind: 'model'; model: string }
