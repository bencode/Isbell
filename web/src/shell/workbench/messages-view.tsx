// The right column's Messages, from each machine's messages book: one list, the latest active first,
// a reply bringing its message up. A message opens in place; at its foot, who sent it (looked at
// while it runs, its record opened once it ended), what it links to and the task it is about, with
// the machine once more than one has messages.

import { useState } from 'react'
import { useGoalShelves, useMessageFeed, useRunningSession } from '../../core/books'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { AGENT_NAMES } from '../../features/session/session-row'
import { rootHolding } from '../../model/files/worktrees'
import { type Link, parseLink } from '../../model/messages'
import { closedTabId, withTab } from '../../model/tabs'
import { projectHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { MessageRow, type Tag } from './message-row'
import { usePeek } from './peek'
import { fileTabId } from './tab-kinds'

const basename = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export function MessagesView() {
  const t = useI18n()
  const now = useNow()
  const posted = useMessageFeed()
  const running = useRunningSession()
  const projects = useProjects()
  const shelves = useGoalShelves()
  const { open: peekAt } = usePeek()
  // The message opened, by its machine and number.
  const [opened, setOpened] = useState<string | null>(null)

  if (!posted.length) return <p className="m-0 px-3.5 py-2 text-xs text-muted">{t('messages.none')}</p>

  const named = new Set(posted.map(p => p.mid)).size > 1
  const asking = posted.filter(({ message }) => message.kind === 'ask').length
  /** The project on `mid` a path is in, the deepest holding it, and where it is under it. */
  const projectAt = (mid: string, path: string) => {
    const roots = projects
      .filter(p => p.mid === mid && p.path)
      .map(p => ({ key: p.key, path: p.path, display: p.display, branch: null, own: true }))
    const found = rootHolding(roots, path)
    const project = found && projects.find(p => p.key === found.root.key)
    return project && found ? { project, rel: found.rel } : undefined
  }
  const projectName = (p: (typeof projects)[number]) => (p.configured ? p.name : p.display)
  /** A session: looked at while it runs; else its record, in the project `dir` is in. */
  const sessionTag = (mid: string, agent: string, id: string, who: string, dir: string | undefined) => {
    const at = dir ? projectAt(mid, dir) : undefined
    const placed = running(mid, agent, id)
    const where = [at && projectName(at.project), named ? posted.find(p => p.mid === mid)?.name : undefined]
      .filter(Boolean)
      .join(' · ')
    const label = (
      <>
        <b className="font-semibold">{who}</b>
        {where ? ` ${where}` : ''}
      </>
    )
    const key = `session:${agent}:${id}`
    if (placed) return { key, label, title: t('tasks.peek', { name: who }), onPeek: () => peekAt(placed) }
    const to = at && {
      pathname: projectHref(at.project.key),
      search: withTab('', closedTabId(mid, agent, id)),
    }
    return { key, label, tone: 'gone', ...(to ? { to, title: t('messages.ended') } : {}) } satisfies Tag
  }
  /** A file, opened in a tab in the project it is under; a project, gone to. */
  const pathTag = (mid: string, link: Extract<Link, { path: string }>): Tag => {
    const at = projectAt(mid, link.path)
    const label = link.kind === 'file' || !at ? basename(link.path) : projectName(at.project)
    if (!at) return { key: 'link', label, title: link.path }
    const page = projectHref(at.project.key)
    const to =
      link.kind === 'file' ? { pathname: page, search: withTab('', fileTabId(at.project.key, at.rel)) } : page
    return { key: 'link', label, title: link.path, to }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pt-1.5 pb-3.5">
      <p className="m-0 px-1 pb-1.5 text-xs text-muted">
        {t('messages.summary', { ask: asking, n: posted.length })}
      </p>
      {posted.map(({ mid, message }) => {
        const key = `${mid}:${message.id}`
        const from = message.from
        const link = message.link ? parseLink(message.link) : undefined
        const own = link?.kind === 'session' && from && link.agent === from.agent && link.id === from.session
        const task =
          message.task && shelves.find(s => s.mid === mid)?.book.tasks.find(x => x.id === message.task)
        const tags: Tag[] = [
          ...(from
            ? [
                sessionTag(
                  mid,
                  from.agent,
                  from.session,
                  from.role ?? AGENT_NAMES[from.agent] ?? from.agent,
                  from.dir,
                ),
              ]
            : []),
          ...(link && !own
            ? [
                link.kind === 'session'
                  ? sessionTag(mid, link.agent, link.id, AGENT_NAMES[link.agent] ?? link.agent, from?.dir)
                  : pathTag(mid, link),
              ]
            : []),
          ...(message.task
            ? [
                {
                  key: 'task',
                  label: task ? `T${task.id} ${task.title}` : `T${message.task}`,
                  tone: 'task',
                } satisfies Tag,
              ]
            : []),
        ]
        return (
          <MessageRow
            key={key}
            message={message}
            tags={tags}
            open={opened === key}
            onToggle={() => setOpened(was => (was === key ? null : key))}
            now={now}
          />
        )
      })}
    </div>
  )
}
