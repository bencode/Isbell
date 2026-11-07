// A project's sessions in the second column: those running, agents by when they last changed and
// then its shells; and under them those that ran, by the day they were last active, the months
// before as asked for. Found by part of a name, of what they were asked, or of where they ran: a
// search reads every month. Each opens in a tab.

import { Search } from 'lucide-react'
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
import { byDay, dayKey, lineTime, matches, sessionKey } from '../../model/sessions'
import type { AgentStatus } from '../../model/state'
import { closedTabId, sessionTabId } from '../../model/tabs'
import { since, useNow } from '../../utils/time'

const NOTE = 'm-3 text-[13px] text-muted'
const DAY_MS = 24 * 60 * 60 * 1000

type Row = { id: string; status?: AgentStatus; name: string; cwd: string; words: string; since?: number }

/** The project's panes as the list shows them, newest agent first and shells after. A pane whose
 * agent herdr has not made out is listed as a shell too; it shows once, as the agent. */
function rowsOf(project: Project): Row[] {
  const agentPanes = new Set(project.sessions.map(s => s.paneId))
  const agents = [...project.sessions]
    .sort((a, b) => b.statusSince - a.statusSince)
    .map(s => ({
      id: sessionTabId(s.mid, s.paneId),
      status: s.status,
      name: s.name,
      cwd: s.cwd ?? project.path,
      words: `${s.name}\n${s.title ?? ''}`,
      since: s.statusSince,
    }))
  const shells = project.shells
    .filter(s => !agentPanes.has(s.paneId))
    .map(s => ({
      id: sessionTabId(s.mid, s.paneId),
      name: s.title ?? s.paneId,
      cwd: s.cwd,
      words: `${s.paneId}\n${s.title ?? ''}`,
    }))
  return [...agents, ...shells]
}

const branchOf = (roots: FilesRoot[], cwd: string) => rootHolding(roots, cwd)?.root.branch

const clock = (t: T, ms: number) =>
  new Date(ms).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' })

function dayTitle(t: T, ms: number, now: number) {
  const day = dayKey(ms)
  if (day === dayKey(now)) return t('sessions.today')
  if (day === dayKey(now - DAY_MS)) return t('sessions.yesterday')
  return new Date(ms).toLocaleDateString(t.locale, { month: 'long', day: 'numeric' })
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-1">
      <h3 className="m-0 px-2 pt-2.5 pb-1 text-[11.5px] font-semibold text-faint">{title}</h3>
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
  const row = (id: string) => ({ shown: id === shown, to: href(id), onKeep: () => keep(id) })
  const read = records.recent !== undefined
  const none = read && !running.length && !history.length
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
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {records.error ? (
          <p className="m-2 text-[12.5px] text-danger">
            {t('sessions.failed', { msg: errorText(t, records.error) })}
          </p>
        ) : null}
        {running.length ? (
          <Group title={t('sessions.running')}>
            {running.map(r => (
              <SessionRow
                key={r.id}
                mark={r.status ?? 'shell'}
                name={r.name}
                meta={[
                  branchOf(roots, r.cwd),
                  r.since === undefined ? t('info.terminal') : since(r.since, now),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {...row(r.id)}
              />
            ))}
          </Group>
        ) : null}
        {byDay(history, lineTime).map(day => {
          const first = day[0]
          return (
            <Group key={dayKey(lineTime(first))} title={dayTitle(t, lineTime(first), now)}>
              {day.map(s => {
                const id = closedTabId(project.mid, s.agent, s.id)
                return (
                  <SessionRow
                    key={id}
                    mark="ran"
                    name={s.first}
                    meta={[branchOf(roots, s.cwd), s.agent, clock(t, lineTime(s))]
                      .filter(Boolean)
                      .join(' · ')}
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
