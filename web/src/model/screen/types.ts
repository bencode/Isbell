// What an agent's screen is read into, and the grammar each kind of agent is read by.

export type Block =
  /** A paragraph, its line breaks kept: code arrives as plain lines too. */
  | { kind: 'text'; text: string }
  /** `start` is the first number of a numbered list. */
  | { kind: 'list'; items: string[]; start?: number }
  | { kind: 'action'; verb: string; target: string; output: string[] }

export type Turn = { prompt: string; reply: Block[]; took?: string; at?: string }

/** The turn still going; its prompt is unknown once it has scrolled off the screen. */
export type Live = { prompt?: string; reply: Block[] }

export type Question = {
  text: string
  /** Lines the agent shows around its question, such as the command it wants to run. */
  detail: string[]
  /** `key` is what herdr's send_keys takes to choose the option. */
  options: { key: string; label: string }[]
}

/**
 * What sits below the input box: the model (with its effort, as Codex shows it), the task, the
 * mode as the agent names it, and a status line of the user's own (Claude Code's), kept as it is.
 */
export type Footer = { model?: string; task?: string; mode?: string; line?: string }

export type Reading = {
  /** The start of the session is still on the screen. */
  start: boolean
  turns: Turn[]
  live?: Live
  question?: Question
  footer?: Footer
}

/** Where the conversation ends on the screen, and what sits below it. */
export type Bottom = {
  at: number
  footer?: Footer
  /** Lines `from` up to `to` (exclusive) hold a question with numbered options. */
  ask?: { from: number; to: number }
}

export type Grammar = {
  banner: RegExp
  /** Captures what was asked. */
  prompt: RegExp
  /** The first line of a reply item; captures its text. */
  item: RegExp
  /** Sums up tool calls in a paragraph of one line, or above their output; it starts an item. */
  summary?: RegExp
  /** Where a tool call's output starts, under the call. */
  output?: RegExp
  /** Ends a turn; the groups `took` and `at` capture what the agent shows. */
  end: RegExp
  /** An item that also ends its turn, such as an interruption. */
  stop?: RegExp
  /**
   * While the agent runs, the topmost turn's prompt stays pinned to the top of the screen, above a
   * reply that has scrolled part way under it.
   */
  pinned?: boolean
  /** Lines dropped wherever they appear. */
  noise: RegExp[]
  /** The modes ⇧Tab steps through, as `Footer.mode` names them. */
  modes?: string[]
  /** Commands that put the agent in a mode at once, for modes ⇧Tab does not reach reliably. */
  enter?: Record<string, string>
  /** The item as a tool call, if it is one. */
  action: (head: string, rest: string[]) => Block | undefined
  /** Undefined when the screen does not look like this agent's. */
  bottom: (lines: string[]) => Bottom | undefined
}
