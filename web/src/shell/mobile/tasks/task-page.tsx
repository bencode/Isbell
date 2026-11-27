// A task on a phone, by its machine and number, to read: its state, who follows it, the goal it is
// for, what counts as done and the rest; the files it and its messages link to, opened to read; the
// messages about it; the sessions that worked on it. Agents alone change it.

import { Link, useParams } from 'react-router'
import { useBooks, useGoalShelves, useRunningRoles } from '../../../core/books'
import { useI18n } from '../../../core/i18n'
import { useProjects } from '../../../core/space'
import { AGENT_NAMES } from '../../../features/session/session-row'
import { projectHolding } from '../../../model/files/worktrees'
import { feed, parseLink } from '../../../model/messages'
import { roleKey } from '../../../model/roles'
import { sessionHref } from '../../../utils/hrefs'
import { shortDay, useNow } from '../../../utils/time'
import { BackButton, BarTitle, PhoneBar } from '../bar'
import {
  Absent,
  CARD,
  Fact,
  Facts,
  FileChip,
  goalHref,
  MessageList,
  Owner,
  Priority,
  Section,
  STATE_NAMES,
  StateRing,
} from './parts'

/** The file a link names, if it names one. */
const fileOf = (link: string | undefined) => {
  const found = link === undefined ? undefined : parseLink(link)
  return found?.kind === 'file' ? found.path : undefined
}

export function PhoneTask() {
  const t = useI18n()
  const now = useNow()
  const { mid = '', id = '' } = useParams()
  const shelves = useGoalShelves()
  const shelf = shelves.find(s => s.mid === mid)
  const posted = useBooks()[mid]?.messages?.messages ?? []
  const agents = useRunningRoles()
  const projects = useProjects()
  const task = shelf?.book.tasks.find(x => String(x.id) === id)
  if (!shelf) return <Absent note={t('board.loading')} />
  if (!task) return <Absent note={t('mobile.taskGone')} />

  const goal = shelf.book.goals.find(g => g.id === task.goal)
  const agent = task.owner ? agents.get(roleKey(mid, task.owner)) : undefined
  const messages = feed(posted.filter(m => m.task === task.id).map(message => ({ message }))).map(
    ({ message }) => message,
  )
  const files = [...new Set([task.link, ...messages.map(m => m.link)].flatMap(link => fileOf(link) ?? []))]
  const day = (ms: number) => shortDay(t.locale, ms, now, t('sessions.yesterday'))
  const project = task.project ? projectHolding(projects, mid, task.project) : undefined
  const owner = task.owner ? <Owner name={task.owner} agent={agent} /> : t('mobile.unowned')
  const times = [
    t('goals.added', { d: day(task.createdAt) }),
    task.startedAt === undefined ? '' : t('goals.started', { d: day(task.startedAt) }),
    task.endedAt === undefined
      ? ''
      : t(task.state === 'dropped' ? 'goals.droppedOn' : 'goals.doneOn', { d: day(task.endedAt) }),
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <BackButton />
        <BarTitle
          title={`T${task.id}`}
          where={[
            goal && t('mobile.goalOf', { name: goal.title }),
            shelves.length > 1 ? shelf.name : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </PhoneBar>
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <h1 className="m-0 px-4 pt-4 text-[19px] leading-snug font-bold [overflow-wrap:anywhere]">
          {task.title}
        </h1>
        <div className="px-3 pt-3">
          <Facts>
            <Fact label={t('goals.state')}>
              <span className="inline-flex items-center gap-1.5">
                <StateRing state={task.state} />
                {t(STATE_NAMES[task.state])}
                {task.priority ? <Priority priority={task.priority} /> : null}
              </span>
            </Fact>
            <Fact label={t('goals.owner')}>
              {agent ? (
                <Link to={sessionHref(agent.session.mid, agent.session.paneId)} className="no-underline">
                  {owner}
                </Link>
              ) : (
                owner
              )}
            </Fact>
            <Fact label={t('mobile.goal')}>
              {goal ? (
                <Link to={goalHref(mid, goal.id)} className="text-accent no-underline">
                  {goal.title}
                </Link>
              ) : undefined}
            </Fact>
            <Fact label={t('goals.project')}>
              {project
                ? project.project.configured
                  ? project.project.name
                  : project.project.display
                : task.project}
            </Fact>
            <Fact label={t('tasks.outcome')}>{task.outcome}</Fact>
            <Fact label={t('tasks.text')}>{task.text}</Fact>
            <Fact label={t('tasks.link')}>{fileOf(task.link) ? undefined : task.link}</Fact>
            <Fact label={t('goals.times')}>{times.filter(Boolean).join('\n')}</Fact>
          </Facts>
        </div>
        {files.length ? (
          <Section title={t('mobile.output')} count={files.length}>
            <div className="flex flex-col gap-1.5">
              {files.map(path => (
                <FileChip key={path} mid={mid} path={path} />
              ))}
            </div>
          </Section>
        ) : null}
        {messages.length ? (
          <Section title={t('mobile.messages')} count={messages.length}>
            <MessageList mid={mid} messages={messages} now={now} />
          </Section>
        ) : null}
        {task.sessions.length ? (
          <Section title={t('mobile.worked')} count={task.sessions.length}>
            <div className={CARD}>
              {task.sessions.map(s => (
                <span key={`${s.agent}:${s.id}:${s.at}`} className="px-3 py-2.5 text-[13px] text-muted">
                  {[s.role, AGENT_NAMES[s.agent] ?? s.agent, day(s.at)].filter(Boolean).join(' · ')}
                </span>
              ))}
            </div>
          </Section>
        ) : null}
      </main>
    </div>
  )
}
