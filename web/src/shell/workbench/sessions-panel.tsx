// A project's sessions in the second column: those running, agents asking first, the rest by when
// they last changed, and then its shells; and under them those that ran, by the day they were last active, the months
// before as asked for. Found by part of a name, of what they were asked, or of where they ran: a
// search reads every month. Each opens in a tab.

import { Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../../components/button'
import { errorText, type T, useI18n } from '../../core/i18n'
import { useSessionRecords } from '../../core/session-records'
import { useProjects } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { useFilesRoots } from '../../core/worktrees'
import { SessionRow } from '../../features/session/session-row'
import { type FilesRoot, rootHolding } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import { byDay, dayKey, excerpt, lineTime, matches, sessionKey } from '../../model/sessions'
import type { AgentStatus } from '../../model/state'
import { closedTabId, sessionTabId, withTerminal } from '../../model/tabs'
import { clock, dayTitle, since, useNow } from '../../utils/time'

const NOTE = 'm-3 text-[13px] text-muted'

/** `query`: what the row opens its tab with, a shell's showing its terminal. */
type Row = {
  id: string
  query?: string
  mark: AgentStatus | 'shell'
  asking?: boolean
  /** The task the agent's terminal is titled with. */
  title?: string | undefined
  name: string
  cwd: string
  words: string
  since?: number
}

/** The project's panes as the list shows them, newest agent first and shells after. A pane whose
 * agent herdr has not made out is listed as a shell too; it shows once, as the agent. */
function rowsOf(project: Project): Row[] {
  const agentPanes = new Set(project.sessions.map(s => s.paneId))
  const agents = [...project.sessions]
    .sort(
      (a, b) =>
        Number(b.status === 'blocked') - Number(a.status === 'blocked') || b.statusSince - a.statusSince,
    )
    .map(
      (s): Row => ({
        id: sessionTabId(s.mid, s.paneId),
        // A finished session looked at stands by, as far as this list goes.
        mark: s.status === 'done' && !s.unread ? 'idle' : s.status,
        asking: s.status === 'blocked',
        title: s.title,
        name: s.name,
        cwd: s.cwd ?? project.path,
        words: `${s.name}\n${s.title ?? ''}`,
        since: s.statusSince,
      }),
    )
  const shells = project.shells
    .filter(s => !agentPanes.has(s.paneId))
    .map(
      (s): Row => ({
        id: sessionTabId(s.mid, s.paneId),
        query: withTerminal('', true),
        mark: 'shell',
        name: s.title ?? s.paneId,
        cwd: s.cwd,
        words: `${s.paneId}\n${s.title ?? ''}`,
      }),
    )
  return [...agents, ...shells]
}

/** The branch of the worktree `cwd` is in, if not the project's own directory. */
function branchOf(roots: FilesRoot[], cwd: string) {
  const root = rootHolding(roots, cwd)?.root
  return root && !root.own ? (root.branch ?? undefined) : undefined
}

const dayOf = (t: T, ms: number, now: number) =>
  dayTitle(t.locale, ms, now, { today: t('sessions.today'), yesterday: t('sessions.yesterday') })

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-1">
      <h3 className="sticky top-0 z-1 m-0 bg-side px-2 pt-2.5 pb-1 text-[11.5px] font-semibold text-faint">
        {title}
        {count === undefined ? null : <span className="ml-1 font-mono font-medium">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

export function SessionsPanel({ projectKey }: { projectKey: string }) {
  const t = useI18n()
  const project = useProjects().find(p => p.key === projectKey)
  const { roots } = useFilesRoots(project)
  const records = useSessionRecords(project)
  const { shown } = useTabRoute()
  const { href, keep } = useTabActions()
  const now = useNow()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const { loadAll } = records
  useEffect(() => {
    if (needle) loadAll()
  }, [needle, loadAll])
  if (!project) return <p className={NOTE}>{t('board.loading')}</p>

  const running = rowsOf(project).filter(r => !needle || r.words.toLowerCase().includes(needle))
  const history = records.history.filter(
    s => !records.running.has(sessionKey(s)) && (!needle || matches(s, needle)),
  )
  const row = (id: string, own?: string) => ({
    shown: id === shown,
    to: href(id, own),
    onKeep: () => keep(id),
  })
  const read = records.recent !== undefined
  const found = running.length + history.length
  const none = read && !found
  const inWords = (text: string) => text.toLowerCase().includes(needle)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-2.5 pt-2.5 pb-1.5">
        <label className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
          <Search size={13} className="flex-none text-faint" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('sessions.search')}
            aria-label={t('sessions.search')}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('sessions.clear')}
              title={t('sessions.clear')}
              className="flex-none cursor-pointer border-0 bg-transparent p-0 text-faint hover:text-text"
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
        {needle && found && !records.busy ? (
          <p className="m-0 px-1 pt-1 text-[11.5px] text-faint">{t('sessions.found', { n: found })}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {records.error ? (
          <p className="m-2 text-[12.5px] text-danger">
            {t('sessions.failed', { msg: errorText(t, records.error) })}
          </p>
        ) : null}
        {running.length ? (
          <Group title={t('sessions.running')} count={running.length}>
            {running.map(r => (
              <SessionRow
                key={r.id}
                mark={r.mark}
                name={r.name}
                detail={r.asking ? t('sessions.asking') : r.title}
                asking={r.asking}
                branch={branchOf(roots, r.cwd)}
                time={r.since === undefined ? undefined : since(r.since, now)}
                needle={needle}
                {...row(r.id, r.query)}
              />
            ))}
          </Group>
        ) : null}
        {byDay(history, lineTime).map(day => {
          const first = day[0]
          return (
            <Group key={dayKey(lineTime(first))} title={dayOf(t, lineTime(first), now)}>
              {day.map(s => {
                const id = closedTabId(project.mid, s.agent, s.id)
                // Found by something other than its name: what it was found by.
                const by = needle && !inWords(s.first) ? [s.last ?? '', s.cwd].find(inWords) : undefined
                return (
                  <SessionRow
                    key={id}
                    mark={{ agent: s.agent }}
                    name={s.first}
                    detail={by && excerpt(by, needle)}
                    time={clock(t.locale, lineTime(s))}
                    hint={[s.first, branchOf(roots, s.cwd)].filter(Boolean).join(' · ')}
                    needle={needle}
                    {...row(id)}
                  />
                )
              })}
            </Group>
          )
        })}
        {!read && !running.length && !records.error ? <p className={NOTE}>{t('sessions.loading')}</p> : null}
        {none && !records.more ? (
          <p className={NOTE}>{t(needle ? 'sessions.noMatch' : 'sessions.empty')}</p>
        ) : null}
        {records.more && !needle ? (
          <div className="flex justify-center pt-2">
            <Button size="small" disabled={records.busy} onClick={records.loadOlder}>
              {t('sessions.more')}
            </Button>
          </div>
        ) : null}
        {needle && records.busy ? <p className={NOTE}>{t('sessions.loading')}</p> : null}
      </div>
    </div>
  )
}
