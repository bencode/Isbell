// The right column's Tasks, from each machine's goals book: what is being done now on any of them,
// then each machine's goals as a tree, under its name once more than one has goals, with the tasks
// not ended under them in the order to do them. A goal or a machine folds away, and the goals ended
// wait folded at the end; each stays as it was left.

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useBooks, useRoleOf } from '../../core/books'
import { useI18n } from '../../core/i18n'
import { toggleTaskKey, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import {
  ended,
  type Goal,
  type GoalNode,
  type Goals,
  nowTasks,
  openTree,
  type Task,
  taskCount,
} from '../../model/goals'
import { lanes } from '../../model/projects'
import { roleKey } from '../../model/roles'
import { useNow } from '../../utils/time'
import { MachineHeading } from './machine-heading'
import { usePeek } from './peek'
import { TaskRow } from './task-row'

type Shelf = { mid: string; name: string; book: Goals }

const INDENT = 14

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** A goal's period or due date, short: Nov, W48, 11/23. */
function when(locale: string, value: string) {
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month)
    return new Date(Number(month[1]), Number(month[2]) - 1).toLocaleDateString(locale, { month: 'short' })
  const week = /^\d{4}-(W\d{2})$/.exec(value)
  if (week) return week[1]
  const day = /^\d{4}-(\d{2})-(\d{2})$/.exec(value)
  return day ? `${Number(day[1])}/${Number(day[2])}` : value
}

function GoalRow(props: { goal: Goal; depth: number; open: boolean; count: number; onToggle: () => void }) {
  const t = useI18n()
  const { goal, depth, open, count, onToggle } = props
  const side = open
    ? [goal.period, goal.due].flatMap(v => (v ? [when(t.locale, v)] : [])).join(' · ')
    : String(count)
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      title={goal.outcome}
      style={{ paddingLeft: 6 + depth * INDENT }}
      className="flex flex-none cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent py-1 pr-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span
        className={`flex w-3 flex-none justify-center text-faint transition-transform duration-100 ${open ? '' : '-rotate-90'}`}
      >
        <ChevronDown aria-hidden size={11} />
      </span>
      <span className="min-w-[26px] flex-none font-mono text-[11px] text-faint">G{goal.id}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{goal.title}</span>
      {side ? <span className="flex-none font-mono text-[11px] text-faint">{side}</span> : null}
    </button>
  )
}

export function TasksView() {
  const t = useI18n()
  const now = useNow()
  const books = useBooks()
  const { machines } = useSpaceView()
  const toggles = useLocal().layout.taskToggles
  const live = lanes(useProjects())
  const roleFor = useRoleOf()
  const { open: peekAt } = usePeek()
  // The task opened, where it was: in Now or in the tree.
  const [opened, setOpened] = useState<string | null>(null)

  const shelves: Shelf[] = machines
    .filter(m => m.online)
    .flatMap(({ state: { machine } }) => {
      const book = books[machine.id]?.goals
      return book ? [{ mid: machine.id, name: machine.name, book }] : []
    })
  if (!shelves.length) return <p className="m-0 px-4 py-3 text-[13px] text-muted">{t('tasks.none')}</p>

  // With goals on one machine only, as most have, its name says nothing.
  const named = shelves.length > 1
  const agents = new Map(
    [...live.asking, ...live.running, ...live.finished, ...live.standing].flatMap(p => {
      const role = roleFor(p)
      return role ? [[roleKey(p.session.mid, role.name), p] as const] : []
    }),
  )
  const items = shelves.flatMap(shelf => shelf.book.tasks.map(task => ({ shelf, task })))
  const count = (state: Task['state']) => items.filter(i => i.task.state === state).length

  const row = (where: 'now' | 'tree', shelf: Shelf, task: Task) => {
    const key = `${where}:${shelf.mid}:${task.id}`
    const agent = task.owner ? agents.get(roleKey(shelf.mid, task.owner)) : undefined
    const goal = shelf.book.goals.find(g => g.id === task.goal)
    const under =
      where === 'now' ? [goal?.title, named ? shelf.name : undefined].filter(Boolean).join(' · ') : undefined
    return (
      <TaskRow
        key={key}
        task={task}
        under={under}
        onPeek={agent ? () => peekAt(agent) : undefined}
        open={opened === key}
        onToggle={() => setOpened(o => (o === key ? null : key))}
        now={now}
      />
    )
  }

  const tree = (shelf: Shelf, nodes: GoalNode[], depth: number): ReactNode[] =>
    nodes.flatMap(node => {
      const key = `goal:${shelf.mid}:${node.goal.id}`
      const open = !toggles.includes(key)
      return [
        <GoalRow
          key={key}
          goal={node.goal}
          depth={depth}
          open={open}
          count={taskCount(node)}
          onToggle={() => toggleTaskKey(key)}
        />,
        ...(open
          ? [
              <div
                key={`${key}:tasks`}
                className="flex flex-col"
                style={{ marginLeft: (depth + 1) * INDENT }}
              >
                {node.tasks.map(task => row('tree', shelf, task))}
              </div>,
              ...tree(shelf, node.children, depth + 1),
            ]
          : []),
      ]
    })

  const endedGoals = (shelf: Shelf) => {
    const goals = shelf.book.goals.filter(g => ended(g.state))
    if (!goals.length) return null
    const key = `ended:${shelf.mid}`
    const shown = toggles.includes(key)
    return (
      <>
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => toggleTaskKey(key)}
          className="flex h-6 flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-faint hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={`inline-flex transition-transform duration-100 ${shown ? '' : '-rotate-90'}`}>
            <ChevronDown aria-hidden size={11} />
          </span>
          {t('tasks.ended', { n: goals.length })}
        </button>
        {shown
          ? goals.map(goal => (
              <div
                key={goal.id}
                className="flex items-center gap-1.5 py-1 pr-1.5 pl-6 text-[13px] text-faint"
              >
                <span className="min-w-[26px] flex-none font-mono text-[11px]">G{goal.id}</span>
                <span className="min-w-0 truncate">
                  {goal.state === 'done' ? '✓' : '✕'} {goal.title}
                </span>
              </div>
            ))
          : null}
      </>
    )
  }

  const heading = 'm-0 px-1 pt-2.5 pb-0.5 text-[11.5px] font-semibold text-faint'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pt-1.5 pb-3.5">
      <p className="m-0 px-1 pb-1 text-xs text-muted">
        {t('tasks.summary', { doing: count('doing'), todo: count('todo') })}
      </p>
      <h3 className={heading}>{t('tasks.now')}</h3>
      {nowTasks(items, startOfDay(now)).map(({ shelf, task }) => row('now', shelf, task))}
      <h3 className={heading}>{t('tasks.goals')}</h3>
      {shelves.map(shelf => {
        const key = `machine:${shelf.mid}`
        const open = !(named && toggles.includes(key))
        return (
          <section key={shelf.mid} className="flex flex-none flex-col pb-2">
            {named ? (
              <MachineHeading
                name={shelf.name}
                count={shelf.book.tasks.filter(task => !ended(task.state)).length}
                asking={0}
                open={open}
                onToggle={() => toggleTaskKey(key)}
              />
            ) : null}
            {open ? (
              <>
                {tree(shelf, openTree(shelf.book), 0)}
                {endedGoals(shelf)}
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
