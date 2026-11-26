// The Goals tab: every goal and task on the machines online, ended ones too, each machine's as a tree
// in its order, under its name once more than one has goals. Narrowed by state, owner and words, a
// task comes with the goals above it; one opened shows the rest of it under its row. What it is
// narrowed to, folded and opened stays while the tab is open.

import { Check, ChevronDown, Search, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { DropdownMenu } from '../../../components/menu'
import { Segmented } from '../../../components/segmented'
import { type Shelf, useGoalShelves, useRunningRoles } from '../../../core/books'
import { type Key, useI18n } from '../../../core/i18n'
import { useProjects } from '../../../core/space'
import {
  ended,
  type Goal,
  type GoalNode,
  type Progress,
  periodLabel,
  pickedTree,
  picksTask,
  progressOf,
  type Show,
  type Task,
  type TaskFilter,
} from '../../../model/goals'
import { roleKey } from '../../../model/roles'
import { shortDay, useNow } from '../../../utils/time'
import { MachineHeading } from '../machine-heading'
import { PRIORITIES, STATES } from '../task-row'
import { GoalDetail, TaskDetail } from './goal-detail'

/** A goal or a task, by its machine and number. */
type Picked = { mid: string; kind: 'goal' | 'task'; id: number }

const SHOWS: { value: Show; label: Key }[] = [
  { value: 'open', label: 'goals.open' },
  { value: 'all', label: 'goals.all' },
  { value: 'done', label: 'goals.done' },
  { value: 'dropped', label: 'goals.dropped' },
]

// Narrow, as beside both right columns, a task leaves out its project and a goal its bar.
const TASK_COLS =
  'grid-cols-[14px_34px_minmax(0,1fr)_30px_76px_110px_84px] @max-[620px]:grid-cols-[14px_34px_minmax(0,1fr)_30px_76px_84px]'
const GOAL_COLS =
  'grid-cols-[14px_34px_minmax(0,1fr)_232px_84px] @max-[620px]:grid-cols-[14px_34px_minmax(0,1fr)_48px_84px]'
const WIDE = '@max-[620px]:hidden'
const ROW = 'relative grid min-h-[30px] items-center gap-2 rounded-[7px] pr-2 text-[13px]'
const OVER =
  'min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left outline-none after:absolute after:inset-0 after:rounded-[7px] focus-visible:after:outline-2 focus-visible:after:outline-accent'
const pad = (depth: number) => 8 + depth * 16
// What is opened starts its text under the row's title: past the state, the number and the gaps after
// them, less its own padding.
const inset = (depth: number) => pad(depth) + 14 + 34 + 2 * 8 - 14

/** `text` with what `needle` finds in it marked. */
function marked(text: string, needle: string | undefined): ReactNode {
  if (!needle) return text
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return text
  const end = at + needle.length
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-accent-soft text-inherit">{text.slice(at, end)}</mark>
      {marked(text.slice(end), needle)}
    </>
  )
}

const samePick = (a: Picked | null, b: Picked) => a?.mid === b.mid && a.kind === b.kind && a.id === b.id
const SELECTED = 'bg-selected shadow-[inset_2px_0_0_var(--accent)]'

export function GoalsTab() {
  const t = useI18n()
  const now = useNow()
  const shelves = useGoalShelves()
  const agents = useRunningRoles()
  const projects = useProjects()
  const [filter, setFilter] = useState<TaskFilter>({ show: 'open' })
  const [folds, setFolds] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const pick = (it: Picked) => setPicked(was => (samePick(was, it) ? null : it))

  if (!shelves.length) return <p className="m-0 px-5 py-4 text-[13px] text-muted">{t('tasks.none')}</p>

  // With goals on one machine only, as most have, its name says nothing anywhere.
  const named = shelves.length > 1
  const filtering: TaskFilter = { ...filter, needle: query.trim() || undefined }
  const tasks = shelves.flatMap(s => s.book.tasks)
  const count = (show: Show) => tasks.filter(task => picksTask({ show }, task)).length
  const inState = (state: Task['state']) => tasks.filter(task => task.state === state).length
  const owners = [...new Set(tasks.flatMap(task => (task.owner ? [task.owner] : [])))]
  const day = (ms: number) => shortDay(t.locale, ms, now, t('sessions.yesterday'))
  const toggle = (key: string) =>
    setFolds(was => new Set(was.has(key) ? [...was].filter(k => k !== key) : [...was, key]))
  const projectName = (mid: string, path: string) => {
    const project = projects.find(p => p.mid === mid && p.path === path)
    return project ? (project.configured ? project.name : project.display) : (path.split('/').pop() ?? path)
  }

  const taskRows = (shelf: Shelf, task: Task, depth: number): ReactNode[] => {
    const it: Picked = { mid: shelf.mid, kind: 'task', id: task.id }
    const opened = samePick(picked, it)
    const state = STATES[task.state]
    const agent = task.owner ? agents.get(roleKey(shelf.mid, task.owner)) : undefined
    const project = task.project ? projectName(shelf.mid, task.project) : undefined
    const at = ended(task.state) ? task.endedAt : task.state === 'doing' ? task.startedAt : task.createdAt
    return [
      <div
        key={`T${task.id}`}
        style={{ paddingLeft: pad(depth) }}
        className={`${ROW} ${TASK_COLS} ${opened ? SELECTED : 'hover:bg-hover'}`}
      >
        <span aria-hidden className={`text-center text-xs leading-none ${state.tone}`}>
          {state.glyph}
        </span>
        <span className="font-mono text-[11px] text-faint">T{task.id}</span>
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => pick(it)}
          className={`${OVER} ${ended(task.state) ? 'text-faint' : 'text-text'} ${task.state === 'dropped' ? 'line-through decoration-line-strong' : ''}`}
        >
          {marked(task.title, filtering.needle)}
        </button>
        <span
          className={`font-mono text-[10.5px] font-semibold ${task.priority ? PRIORITIES[task.priority] : ''}`}
        >
          {task.priority}
        </span>
        <span
          className={`truncate text-xs ${agent ? 'text-text underline decoration-line-strong decoration-dotted underline-offset-[3px]' : 'text-muted'}`}
        >
          {task.owner}
        </span>
        <span className={`truncate text-xs text-muted ${WIDE}`}>{project}</span>
        <span className="text-right font-mono text-[11px] text-faint">{at ? day(at) : null}</span>
      </div>,
      opened ? (
        <TaskDetail
          key={`T${task.id}:open`}
          mid={shelf.mid}
          task={task}
          agent={agent}
          project={project}
          inset={inset(depth)}
          day={day}
        />
      ) : null,
    ]
  }

  const goalRows = (shelf: Shelf, goal: Goal, depth: number, progress: Progress | undefined): ReactNode[] => {
    const key = `goal:${shelf.mid}:${goal.id}`
    const it: Picked = { mid: shelf.mid, kind: 'goal', id: goal.id }
    const opened = samePick(picked, it)
    const open = !folds.has(key)
    const side = ended(goal.state)
      ? goal.endedAt &&
        t(goal.state === 'done' ? 'goals.doneOn' : 'goals.droppedOn', { d: day(goal.endedAt) })
      : [goal.period, goal.due].flatMap(v => (v ? [periodLabel(t.locale, v)] : [])).join(' · ')
    return [
      <div
        key={key}
        style={{ paddingLeft: pad(depth) }}
        className={`${ROW} ${GOAL_COLS} ${opened ? SELECTED : 'hover:bg-hover'}`}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggle(key)}
          className="relative z-[1] flex cursor-pointer justify-center rounded border-0 bg-transparent p-0 text-faint hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronDown size={11} className={open ? '' : '-rotate-90'} />
        </button>
        <span className="font-mono text-[11px] text-faint">G{goal.id}</span>
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => pick(it)}
          className={`${OVER} ${ended(goal.state) ? 'font-medium text-faint' : 'font-semibold text-text'}`}
        >
          {goal.state === 'done' ? '✓ ' : goal.state === 'dropped' ? '✕ ' : ''}
          {marked(goal.title, filtering.needle)}
        </button>
        <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
          {progress?.total ? (
            <>
              <span className={`h-1 w-[120px] flex-none overflow-hidden rounded-sm bg-line ${WIDE}`}>
                <span
                  className="block h-full bg-ok"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
              {progress.done}/{progress.total}
            </>
          ) : null}
        </span>
        <span className="truncate text-right font-mono text-[11px] text-faint">{side}</span>
      </div>,
      opened ? (
        <GoalDetail
          key={`${key}:open`}
          mid={shelf.mid}
          goal={goal}
          progress={progress}
          inset={inset(depth)}
          day={day}
        />
      ) : null,
    ]
  }

  const tree = (shelf: Shelf, nodes: GoalNode[], depth: number, progress: ReadonlyMap<number, Progress>) =>
    nodes.flatMap((node): ReactNode[] => [
      ...goalRows(shelf, node.goal, depth, progress.get(node.goal.id)),
      ...(folds.has(`goal:${shelf.mid}:${node.goal.id}`)
        ? []
        : [
            ...node.tasks.flatMap(task => taskRows(shelf, task, depth + 1)),
            ...tree(shelf, node.children, depth + 1, progress),
          ]),
    ])

  const sections = shelves.flatMap(shelf => {
    const nodes = pickedTree(shelf.book, filtering)
    if (!nodes.length) return []
    const key = `machine:${shelf.mid}`
    const open = !(named && folds.has(key))
    return [
      <section key={shelf.mid} className="flex flex-col">
        {named ? (
          <MachineHeading
            name={shelf.name}
            count={shelf.book.tasks.filter(task => picksTask(filtering, task)).length}
            asking={0}
            open={open}
            onToggle={() => toggle(key)}
          />
        ) : null}
        {open ? tree(shelf, nodes, 0, progressOf(shelf.book)) : null}
      </section>,
    ]
  })
  const head = 'text-[11px] text-faint'
  const owner = filter.owner

  return (
    // Narrow, as beside both right columns, the rows leave out what matters least.
    <div className="@container flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-[18px] pt-3 pb-2.5">
        <h2 className="m-0 mr-2 text-[15px] font-semibold">Goals</h2>
        <span className="mr-auto text-xs whitespace-nowrap text-muted">
          {t('goals.summary', { doing: inState('doing'), todo: inState('todo'), done: inState('done') })}
        </span>
        <Segmented
          compact
          label={t('goals.state')}
          value={filter.show}
          onChange={show => setFilter(f => ({ ...f, show }))}
          segments={SHOWS.map(({ value, label }) => ({
            value,
            label: (
              <>
                {t(label)}
                <span className="ml-1 font-normal text-faint">{count(value)}</span>
              </>
            ),
          }))}
        />
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label={t('goals.owner')}
              className="inline-flex h-[26px] max-w-[160px] cursor-pointer items-center gap-1 rounded-md border border-line bg-raised px-2 text-xs text-text outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="truncate">{owner ?? t('goals.anyone')}</span>
              <ChevronDown size={12} className="flex-none text-faint" />
            </button>
          }
          items={[undefined, ...owners].map(value => ({
            label: (
              <>
                <Check size={13} className={`flex-none ${value === owner ? '' : 'invisible'}`} />
                <span className="truncate">{value ?? t('goals.anyone')}</span>
              </>
            ),
            onClick: () => setFilter(f => ({ ...f, owner: value })),
          }))}
        />
        <label className="flex h-[26px] w-[200px] items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
          <Search size={12} className="flex-none text-faint" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('goals.search')}
            aria-label={t('goals.search')}
            className="min-w-0 flex-1 border-0 bg-transparent text-xs text-text outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('sessions.clear')}
              title={t('sessions.clear')}
              className="flex-none cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
            >
              <X size={12} />
            </button>
          ) : null}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-6">
        <div className={`grid gap-2 pr-2 pb-1 pl-2 ${TASK_COLS}`}>
          <span />
          <span />
          <span className={head}>{t('goals.title')}</span>
          <span />
          <span className={head}>{t('goals.owner')}</span>
          <span className={`${head} ${WIDE}`}>{t('goals.project')}</span>
          <span className={`${head} text-right`}>{t('goals.date')}</span>
        </div>
        {sections.length ? (
          sections
        ) : (
          <p className="m-0 px-2 py-6 text-[13px] text-muted">{t('goals.empty')}</p>
        )}
      </div>
    </div>
  )
}
