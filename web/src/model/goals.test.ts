import { describe, expect, test } from 'vitest'
import {
  type Goal,
  type GoalNode,
  type Goals,
  nowTasks,
  openTree,
  parseGoals,
  pickedTree,
  progressOf,
  type Task,
  type TaskFilter,
  taskCount,
  todoTasks,
} from './goals'

const goal = (id: number, extra: Partial<Goal> = {}): Goal => ({
  id,
  title: `G${id}`,
  outcome: 'done',
  state: 'open',
  createdAt: 1,
  ...extra,
})
const task = (id: number, extra: Partial<Task> = {}): Task => ({
  id,
  goal: 1,
  title: `T${id}`,
  state: 'todo',
  createdAt: 1,
  sessions: [],
  ...extra,
})

const shape = (n: GoalNode): unknown => ({
  id: n.goal.id,
  tasks: n.tasks.map(t => t.id),
  children: n.children.map(shape),
})

describe('parseGoals', () => {
  test('reads what the CLI writes, a task with no sessions having none', () => {
    const text = JSON.stringify({
      version: 1,
      lastGoal: 1,
      lastTask: 1,
      goals: [{ id: 1, title: 'Ship', outcome: 'shipped', state: 'open', createdAt: 1 }],
      tasks: [{ id: 1, goal: 1, title: 'Build', state: 'doing', priority: 'P0', createdAt: 1, startedAt: 2 }],
    })
    expect(parseGoals(text)).toEqual({
      goals: [{ id: 1, title: 'Ship', outcome: 'shipped', state: 'open', createdAt: 1 }],
      tasks: [
        {
          id: 1,
          goal: 1,
          title: 'Build',
          state: 'doing',
          priority: 'P0',
          createdAt: 1,
          startedAt: 2,
          sessions: [],
        },
      ],
    })
  })

  test.each([
    ['not JSON', '{'],
    ['another version', '{"version":2,"goals":[],"tasks":[]}'],
    ['a goal with no outcome', '{"version":1,"goals":[{"id":1,"title":"a","state":"open"}],"tasks":[]}'],
    [
      'a goal with no time it was added',
      '{"version":1,"goals":[{"id":1,"title":"a","outcome":"b","state":"open"}],"tasks":[]}',
    ],
    [
      'a task in no state',
      '{"version":1,"goals":[],"tasks":[{"id":1,"goal":1,"title":"a","state":"later"}]}',
    ],
  ])('%s is no goals', (_, text) => {
    expect(parseGoals(text)).toBeUndefined()
  })
})

test('now: the tasks doing, the most pressing then the longest going, then those done today', () => {
  const items = [
    task(1, { state: 'doing', startedAt: 1 }),
    task(2, { state: 'doing', priority: 'P1', startedAt: 5 }),
    task(3, { state: 'doing', priority: 'P0', startedAt: 9 }),
    task(4, { state: 'done', endedAt: 120 }),
    task(5, { state: 'done', endedAt: 50 }),
    task(6, { state: 'dropped', endedAt: 130 }),
    task(7, { state: 'todo' }),
    task(8, { state: 'doing', priority: 'P1', startedAt: 2 }),
  ].map(t => ({ task: t }))
  expect(nowTasks(items, 100).map(i => i.task.id)).toEqual([3, 8, 2, 1, 4])
})

test('to do: the most pressing first, else in the order of the book', () => {
  const items = [
    task(1),
    task(2, { priority: 'P1' }),
    task(3, { state: 'doing', priority: 'P0' }),
    task(4),
    task(5, { priority: 'P0' }),
    task(6, { priority: 'P1' }),
  ].map(t => ({ task: t }))
  expect(todoTasks(items).map(i => i.task.id)).toEqual([5, 2, 6, 1, 4])
})

describe('openTree', () => {
  const book: Goals = {
    goals: [
      goal(1),
      goal(2, { parent: 1 }),
      goal(3, { parent: 1, state: 'done' }),
      goal(4, { parent: 3 }),
      goal(5, { parent: 9 }),
    ],
    tasks: [
      task(1, { goal: 1 }),
      task(2, { goal: 2, state: 'doing' }),
      task(3, { goal: 2, state: 'done' }),
      task(4, { goal: 4 }),
    ],
  }

  test('the goals not ended with their tasks not ended, one under an ended or missing goal at the top', () => {
    const tree = openTree(book)
    expect(tree.map(shape)).toEqual([
      { id: 1, tasks: [1], children: [{ id: 2, tasks: [2], children: [] }] },
      { id: 4, tasks: [4], children: [] },
      { id: 5, tasks: [], children: [] },
    ])
  })

  test('a goal counts the tasks not ended under it, at every level', () => {
    expect(openTree(book).map(taskCount)).toEqual([2, 1, 0])
  })
})

describe('the full list', () => {
  const book: Goals = {
    goals: [
      goal(1, { title: 'Ship v2' }),
      goal(2, { parent: 1, title: 'Roles' }),
      goal(3, { state: 'done' }),
    ],
    tasks: [
      task(1, { goal: 2, owner: 'Euler', title: 'Name agents' }),
      task(2, { goal: 2, state: 'done', owner: 'Gauss' }),
      task(3, { goal: 3, state: 'done', text: 'Read the roles first' }),
      task(4, { goal: 3, state: 'dropped' }),
    ],
  }
  const tree = (filter: TaskFilter) => pickedTree(book, filter).map(shape)

  test('not ended: the open goals with their open tasks', () => {
    expect(tree({ show: 'open' })).toEqual([
      { id: 1, tasks: [], children: [{ id: 2, tasks: [1], children: [] }] },
    ])
  })

  test('done: the tasks done, with the goals above them, and the goals done', () => {
    expect(tree({ show: 'done' })).toEqual([
      { id: 1, tasks: [], children: [{ id: 2, tasks: [2], children: [] }] },
      { id: 3, tasks: [3], children: [] },
    ])
  })

  test('an owner leaves the goals only above their tasks', () => {
    expect(tree({ show: 'all', owner: 'Gauss' })).toEqual([
      { id: 1, tasks: [], children: [{ id: 2, tasks: [2], children: [] }] },
    ])
  })

  test('words find a task by its title or text, a goal by its title', () => {
    expect(tree({ show: 'all', needle: 'ROLES' })).toEqual([
      { id: 1, tasks: [], children: [{ id: 2, tasks: [], children: [] }] },
      { id: 3, tasks: [3], children: [] },
    ])
  })

  test('progress counts the tasks under every level, whatever is shown', () => {
    const progress = progressOf(book)
    expect([1, 2, 3].map(id => progress.get(id))).toEqual([
      { done: 1, total: 2 },
      { done: 1, total: 2 },
      { done: 1, total: 2 },
    ])
  })
})
