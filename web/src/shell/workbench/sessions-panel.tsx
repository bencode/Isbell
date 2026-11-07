// A project's running sessions in the second column, agents by when they last changed, then its
// shells; found by part of a name or a title. Each opens in a tab.

import { Search } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { useFilesRoots } from '../../core/worktrees'
import { SessionRow } from '../../features/session/session-row'
import { type FilesRoot, rootHolding } from '../../model/files/worktrees'
import type { Project } from '../../model/projects'
import type { AgentStatus } from '../../model/state'
import { since, useNow } from '../../utils/time'
import { sessionTabId } from './tab-kinds'

const NOTE = 'm-3 text-[13px] text-muted'

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

export function SessionsPanel({ projectKey }: { projectKey: string }) {
  const t = useI18n()
  const project = useProjects().find(p => p.key === projectKey)
  const { roots } = useFilesRoots(project)
  const { shown } = useTabRoute()
  const { href, keep } = useTabActions()
  const now = useNow()
  const [query, setQuery] = useState('')
  if (!project) return <p className={NOTE}>{t('board.loading')}</p>
  const all = rowsOf(project)
  const needle = query.trim().toLowerCase()
  const rows = needle ? all.filter(r => r.words.toLowerCase().includes(needle)) : all
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
        {!all.length ? (
          <p className={NOTE}>{t('sessions.none')}</p>
        ) : !rows.length ? (
          <p className={NOTE}>{t('sessions.noMatch')}</p>
        ) : (
          rows.map(row => (
            <SessionRow
              key={row.id}
              status={row.status}
              name={row.name}
              meta={[
                branchOf(roots, row.cwd),
                row.since === undefined ? t('info.terminal') : since(row.since, now),
              ]
                .filter(Boolean)
                .join(' · ')}
              shown={row.id === shown}
              to={href(row.id)}
              onKeep={() => keep(row.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
