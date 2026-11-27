// The user's goals on a machine and the tasks they break into (`isbell goal`, `isbell task`,
// crates/isbell/src/book/goals.rs): goals a tree, each in the order of its importance, tasks in the
// order to do them. Read only here.

export const goalsPath = '~/.isbell/goals.json'

const VERSION = 1

export type TaskState = 'todo' | 'doing' | 'done' | 'dropped'
export type GoalState = 'open' | 'done' | 'dropped'

export type Goal = {
  id: number
  parent?: number
  title: string
  /** What counts as done. */
  outcome: string
  text?: string
  link?: string
  /** A date, as 2026-11-28. */
  due?: string
  /** A month (2026-11), an ISO week (2026-W48) or a day (2026-11-23). */
  period?: string
  state: GoalState
  createdAt: number
  endedAt?: number
}

/** An agent session that added or changed a task; `at` in milliseconds. */
export type TaskSession = { role?: string; agent: string; id: string; dir: string; at: number }

export type Task = {
  id: number
  goal: number
  title: string
  outcome?: string
  text?: string
  link?: string
  /** The role that follows it. */
  owner?: string
  /** The root of its project, as an absolute path. */
  project?: string
  state: TaskState
  /** P2, as the rest, is none. */
  priority?: 'P0' | 'P1'
  createdAt: number
  startedAt?: number
  endedAt?: number
  sessions: TaskSession[]
}

/** What the page reads of the file; the rest of it is for agents. */
export type Goals = { goals: Goal[]; tasks: Task[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const optional = (value: unknown, type: 'string' | 'number') => value === undefined || typeof value === type

const isGoal = (v: unknown) =>
  isObject(v) &&
  typeof v.id === 'number' &&
  optional(v.parent, 'number') &&
  typeof v.title === 'string' &&
  typeof v.outcome === 'string' &&
  ['text', 'link', 'due', 'period'].every(k => optional(v[k], 'string')) &&
  ['open', 'done', 'dropped'].includes(v.state as string) &&
  typeof v.createdAt === 'number' &&
  optional(v.endedAt, 'number')

const isSession = (v: unknown) =>
  isObject(v) &&
  optional(v.role, 'string') &&
  typeof v.agent === 'string' &&
  typeof v.id === 'string' &&
  typeof v.dir === 'string' &&
  typeof v.at === 'number'

const isTask = (v: unknown) =>
  isObject(v) &&
  typeof v.id === 'number' &&
  typeof v.goal === 'number' &&
  typeof v.title === 'string' &&
  ['outcome', 'text', 'link', 'owner', 'project'].every(k => optional(v[k], 'string')) &&
  ['todo', 'doing', 'done', 'dropped'].includes(v.state as string) &&
  (v.priority === undefined || v.priority === 'P0' || v.priority === 'P1') &&
  typeof v.createdAt === 'number' &&
  optional(v.startedAt, 'number') &&
  optional(v.endedAt, 'number') &&
  (v.sessions === undefined || (Array.isArray(v.sessions) && v.sessions.every(isSession)))

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

/** The goals and tasks `text` holds; undefined when it is no such file. */
export function parseGoals(text: string): Goals | undefined {
  const file = parsed(text)
  const ok =
    isObject(file) &&
    file.version === VERSION &&
    Array.isArray(file.goals) &&
    file.goals.every(isGoal) &&
    Array.isArray(file.tasks) &&
    file.tasks.every(isTask)
  if (!ok) return undefined
  const tasks = (file.tasks as (Omit<Task, 'sessions'> & { sessions?: TaskSession[] })[]).map(t => ({
    ...t,
    sessions: t.sessions ?? [],
  }))
  return { goals: file.goals as Goal[], tasks }
}

export const ended = (state: TaskState | GoalState) => state === 'done' || state === 'dropped'

const RANK = { P0: 0, P1: 1 }
const rank = (task: Task) => (task.priority ? RANK[task.priority] : 2)

/** What is being done now: the tasks doing, the most pressing first, then the longest going; then
 * those done since `dayStart`, in the order they were. */
export function nowTasks<T extends { task: Task }>(items: T[], dayStart: number): T[] {
  const doing = items
    .filter(({ task }) => task.state === 'doing')
    .sort((a, b) => rank(a.task) - rank(b.task) || (a.task.startedAt ?? 0) - (b.task.startedAt ?? 0))
  const doneToday = items
    .filter(({ task }) => task.state === 'done' && (task.endedAt ?? 0) >= dayStart)
    .sort((a, b) => (a.task.endedAt ?? 0) - (b.task.endedAt ?? 0))
  return [...doing, ...doneToday]
}

/** The tasks to do, the most pressing first, else in the order the book has them. */
export const todoTasks = <T extends { task: Task }>(items: T[]): T[] =>
  items.filter(({ task }) => task.state === 'todo').sort((a, b) => rank(a.task) - rank(b.task))

/** `items` by `key`, each group in their order. */
function groupBy<T, K>(items: T[], key: (item: T) => K) {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

export type GoalNode = { goal: Goal; tasks: Task[]; children: GoalNode[] }

/** `goals` as a tree in their order, each with its own of `tasks`; one whose parent is not among
 * them stands at the top. */
function treeOf(goals: Goal[], tasks: Task[]): GoalNode[] {
  const ids = new Set(goals.map(g => g.id))
  const top = (g: Goal) => g.parent === undefined || !ids.has(g.parent)
  const tasksOf = groupBy(tasks, t => t.goal)
  const childrenOf = groupBy(
    goals.filter(g => !top(g)),
    g => g.parent,
  )
  const nodeOf = (goal: Goal): GoalNode => ({
    goal,
    tasks: tasksOf.get(goal.id) ?? [],
    children: (childrenOf.get(goal.id) ?? []).map(nodeOf),
  })
  return goals.filter(top).map(nodeOf)
}

/** The goals not ended, as a tree in their order, each with its tasks not ended. One whose parent
 * has ended, or is gone, stands at the top. */
export const openTree = ({ goals, tasks }: Goals): GoalNode[] =>
  treeOf(
    goals.filter(g => !ended(g.state)),
    tasks.filter(t => !ended(t.state)),
  )

/** Which goals and tasks a list shows: not ended, all, done or dropped. */
export type Show = 'open' | 'all' | 'done' | 'dropped'

/** What the full list is narrowed to: by state, by the role that follows a task, by words. */
export type TaskFilter = { show: Show; owner?: string | undefined; needle?: string | undefined }

const shows = (show: Show, state: TaskState | GoalState) =>
  show === 'all' || (show === 'open' ? !ended(state) : state === show)

const holds = (needle: string | undefined, ...texts: (string | undefined)[]) =>
  !needle || texts.some(text => text?.toLowerCase().includes(needle.toLowerCase()))

export const picksTask = ({ show, owner, needle }: TaskFilter, t: Task) =>
  shows(show, t.state) && (!owner || t.owner === owner) && holds(needle, t.title, t.text)

/** A goal is picked for itself only while no owner is asked for: goals have none. */
export const picksGoal = ({ show, owner, needle }: TaskFilter, g: Goal) =>
  shows(show, g.state) && !owner && holds(needle, g.title)

/** Every goal as a tree with the tasks `filter` picks, keeping a goal picked itself, holding a task
 * picked or above one kept. */
export function pickedTree(book: Goals, filter: TaskFilter): GoalNode[] {
  const pruned = (nodes: GoalNode[]): GoalNode[] =>
    nodes.flatMap(node => {
      const children = pruned(node.children)
      const kept = picksGoal(filter, node.goal) || node.tasks.length > 0 || children.length > 0
      return kept ? [{ ...node, children }] : []
    })
  return pruned(
    treeOf(
      book.goals,
      book.tasks.filter(t => picksTask(filter, t)),
    ),
  )
}

export type Progress = { done: number; total: number }

/** How far each goal is, its own tasks and those of the goals under it, whatever a list shows. */
export function progressOf(book: Goals): ReadonlyMap<number, Progress> {
  const progress = new Map<number, Progress>()
  const walk = (node: GoalNode): Progress => {
    const sum = node.children
      .map(walk)
      .reduce((a, b) => ({ done: a.done + b.done, total: a.total + b.total }), {
        done: node.tasks.filter(t => t.state === 'done').length,
        total: node.tasks.length,
      })
    progress.set(node.goal.id, sum)
    return sum
  }
  treeOf(book.goals, book.tasks).forEach(walk)
  return progress
}

/** A goal's period or due date, short: Nov, W48, 11/23. */
export function periodLabel(locale: string, value: string) {
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month)
    return new Date(Number(month[1]), Number(month[2]) - 1).toLocaleDateString(locale, { month: 'short' })
  const week = /^\d{4}-(W\d{2})$/.exec(value)
  if (week) return week[1]
  const day = /^\d{4}-(\d{2})-(\d{2})$/.exec(value)
  return day ? `${Number(day[1])}/${Number(day[2])}` : value
}

/** The tasks not ended under a goal, its own and those of the goals under it. */
export const taskCount = (node: GoalNode): number =>
  node.tasks.length + node.children.reduce((n, child) => n + taskCount(child), 0)
