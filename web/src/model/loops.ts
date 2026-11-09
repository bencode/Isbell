// Messages a machine sends a running agent on a schedule. What is asked for is a file the browser
// writes and the gateway goes by; how each has gone is a file the gateway writes beside it.

export const loopsPath = '~/.isbell/loops.json'
export const loopRunsPath = '~/.isbell/loops-state.json'

const VERSION = 1

export type Schedule = { everyMinutes: number } | { dailyAt: string }

export type Loop = {
  id: string
  /** The project's directory, to list it under once its pane is gone. */
  project: string
  paneId: string
  schedule: Schedule
  message: string
  /** Clears the context before the run that follows this many; absent keeps it. */
  clearEvery?: number
  enabled: boolean
}

export type LoopRun = {
  nextRunAt?: number
  lastRunAt?: number
  lastResult?: 'sent' | 'clear_failed' | 'send_failed'
}

/** By loop id. */
export type LoopRuns = Readonly<Record<string, LoopRun>>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSchedule = (value: unknown) =>
  isObject(value) && (typeof value.everyMinutes === 'number' || typeof value.dailyAt === 'string')

const isLoop = (value: unknown): value is Loop =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.project === 'string' &&
  typeof value.paneId === 'string' &&
  isSchedule(value.schedule) &&
  typeof value.message === 'string' &&
  typeof value.enabled === 'boolean'

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

/** The loops `text` lists; undefined when it is no such file, which is never written over. */
export function parseLoops(text: string): Loop[] | undefined {
  const file = parsed(text)
  if (!isObject(file) || file.version !== VERSION || !Array.isArray(file.loops)) return undefined
  return file.loops.every(isLoop) ? file.loops : undefined
}

export const serializeLoops = (loops: Loop[]) => `${JSON.stringify({ version: VERSION, loops }, null, 2)}\n`

/** None from a file that is no such thing: it only says how loops have gone. */
export function parseLoopRuns(text: string): LoopRuns {
  const file = parsed(text)
  return isObject(file) ? (file as LoopRuns) : {}
}

export const loopOf = (loops: Loop[], paneId: string) => loops.find(l => l.paneId === paneId)

/** The loops of `project` whose agent is no longer among those `running`, by pane. */
export const endedLoops = (loops: Loop[], project: string, running: ReadonlySet<string>) =>
  loops.filter(l => l.project === project && !running.has(l.paneId))
