// A project's sessions in the second column: those open, the ones that need you or work first, then
// the latest standing by and the rest folded; under them those that ran, by when they were last
// active, the months before as asked for; and its shells last. Found by part of a name, of what they
// were asked, or of where they ran: a search reads every month. Each opens in a tab.

import { ChevronDown, ChevronRight, Clock, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type To, useNavigate } from 'react-router'
import { Button } from '../../components/button'
import { IconButton } from '../../components/icon-button'
import type { MenuItem } from '../../components/menu'
import { errorText, useI18n } from '../../core/i18n'
import { changeLoops, useLoops } from '../../core/loops'
import { toggleEarlier, useLocal } from '../../core/prefs'
import { useSessionRecords } from '../../core/session-records'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import { useTabActions, useTabRoute } from '../../core/tabs'
import { useFilesRoots } from '../../core/worktrees'
import { EndPane } from '../../features/session/end-pane-dialog'
import { SessionRow } from '../../features/session/session-row'
import { SessionTime } from '../../features/session/session-time'
import { type FilesRoot, rootHolding } from '../../model/files/worktrees'
import { endedLoops, type Loop, loopOf } from '../../model/loops'
import type { Project, Session } from '../../model/projects'
import { matches, type SessionLine, sessionKey } from '../../model/sessions'
import { machineOf } from '../../model/space'
import type { AgentStatus } from '../../model/state'
import { sessionTabId, withTerminal } from '../../model/tabs'
import { useNow } from '../../utils/time'
import { Group, SessionsHistory } from './sessions-history'

const NOTE = 'm-3 text-[13px] text-muted'
/** How many of those standing by show before the rest fold. */
const LATEST_IDLE = 5

/** A pane as the list shows it. `query`: what the row opens its tab with, a shell's showing its
 * terminal. */
type Row = {
  id: string
  paneId: string
  query?: string
  /** An agent's kind, `?` while herdr has not made it out; none for a shell. */
  agent?: string
  status?: AgentStatus
  name: string
  /** What you last asked it. */
  said?: string | undefined
  /** Its herdr name, said on hovering it. */
  herdrName?: string
  cwd: string
  words: string
  /** When it came to its status, or was last active. */
  at?: number
}

/** Needs you, works, finished unseen, stands by. */
const rank = (s: Session) =>
  s.status === 'blocked' ? 0 : s.status === 'working' ? 1 : s.status === 'done' && s.unread ? 2 : 3

/** The project's agents as the list shows them, those that need you first; what each is about is
 * the title its agent gives its terminal, else what it was first asked. */
function agentRows(project: Project, recordOf: (paneId: string) => SessionLine | undefined): Row[] {
  return project.sessions
    .map(s => {
      const record = recordOf(s.paneId)
      // One standing by was last active when its record last changed, which a restart leaves be.
      const at = rank(s) < 2 ? s.statusSince : (record?.updated ?? s.statusSince)
      return { s, record, at }
    })
    .sort((a, b) => rank(a.s) - rank(b.s) || b.at - a.at)
    .map(({ s, record, at }): Row => {
      const name = s.title ?? record?.first ?? s.name
      const said = record?.last ?? record?.first
      return {
        id: sessionTabId(s.mid, s.paneId),
        paneId: s.paneId,
        agent: s.kind ?? '?',
        // A finished session looked at stands by, as far as this list goes.
        status: s.status === 'done' && !s.unread ? 'idle' : s.status,
        name,
        said: said === name ? undefined : said,
        herdrName: s.name,
        cwd: s.cwd ?? project.path,
        words: [s.name, s.title ?? '', record?.first ?? '', record?.last ?? ''].join('\n'),
        at,
      }
    })
}

/** Its shells; a pane whose agent herdr has not made out is listed as a shell too, and shows once,
 * as the agent. */
function shellRows(project: Project): Row[] {
  const agentPanes = new Set(project.sessions.map(s => s.paneId))
  return project.shells
    .filter(s => !agentPanes.has(s.paneId))
    .map(
      (s): Row => ({
        id: sessionTabId(s.mid, s.paneId),
        paneId: s.paneId,
        query: withTerminal('', true),
        name: s.title ?? s.paneId,
        cwd: s.cwd,
        words: `${s.paneId}\n${s.title ?? ''}`,
      }),
    )
}

/** The branch of the worktree `cwd` is in, if not the project's own directory. */
function branchOf(roots: FilesRoot[], cwd: string) {
  const root = rootHolding(roots, cwd)?.root
  return root && !root.own ? (root.branch ?? undefined) : undefined
}

/** A scheduled message whose agent is gone: kept until removed, as it may have taken some writing. */
function EndedLoop({ mid, loop }: { mid: string; loop: Loop }) {
  const t = useI18n()
  const { openStream } = useSpace()
  const [failed, setFailed] = useState<string>()
  const remove = () => {
    setFailed(undefined)
    changeLoops(openStream, mid, loops => loops.filter(l => l.id !== loop.id)).catch((err: unknown) => {
      setFailed(errorText(t, err))
    })
  }
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 px-2 py-[3px] text-[13.5px] leading-5 text-faint">
        <Clock size={12} className="flex-none" />
        <span className="min-w-0 flex-1 truncate" title={loop.message}>
          {loop.message}
        </span>
        <IconButton label={t('loop.delete')} size="tiny" onClick={remove}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      {failed ? <p className="m-0 px-2 pb-1 text-[12.5px] text-danger">{failed}</p> : null}
    </div>
  )
}

type PaneRowProps = {
  r: Row
  roots: FilesRoot[]
  now: number
  looping: boolean | undefined
  needle: string
  link: { shown: boolean; to: To; onKeep: () => void }
  onTerminal: (() => void) | undefined
  onEnd: () => void
}

function PaneRow({ r, roots, now, looping, needle, link, onTerminal, onEnd }: PaneRowProps) {
  const t = useI18n()
  const menu: MenuItem[] = [
    ...(onTerminal ? [{ label: t('sessions.inTerminal'), onClick: onTerminal }] : []),
    { label: t('sessions.end'), onClick: onEnd, danger: true },
  ]
  return (
    <SessionRow
      mark={r.agent ? { agent: r.agent, status: r.status } : 'shell'}
      name={r.name}
      detail={r.said}
      said
      branch={branchOf(roots, r.cwd)}
      time={r.at === undefined ? undefined : <SessionTime status={r.status} at={r.at} now={now} />}
      looping={looping}
      hint={r.herdrName}
      menu={menu}
      menuLabel={t('sessions.menu')}
      needle={needle}
      {...link}
    />
  )
}

const standing = (r: Row) => r.status === 'idle' || r.status === 'unknown'

/** Those that need you or work, and the latest standing by unless `all`; and how many more stand by. */
function foldOpen(rows: Row[], all: boolean): { shown: Row[]; more: number } {
  const latest = new Set(rows.filter(standing).slice(0, LATEST_IDLE))
  const more = rows.filter(standing).length - latest.size
  return { shown: all ? rows : rows.filter(r => !standing(r) || latest.has(r)), more }
}

export function SessionsPanel({ projectKey }: { projectKey: string }) {
  const t = useI18n()
  const projects = useProjects()
  const project = projects.find(p => p.key === projectKey)
  const { machines } = useSpaceView()
  const { able, loops } = useLoops(project?.mid ?? '')
  const { roots } = useFilesRoots(project)
  const records = useSessionRecords(project)
  const { shown } = useTabRoute()
  const { href, keep, close } = useTabActions()
  const navigate = useNavigate()
  const { earlierOpen } = useLocal().layout
  const now = useNow()
  const [query, setQuery] = useState('')
  const [ending, setEnding] = useState<Row>()
  const needle = query.trim().toLowerCase()
  const { loadAll } = records
  useEffect(() => {
    if (needle) loadAll()
  }, [needle, loadAll])
  if (!project) return <p className={NOTE}>{t('board.loading')}</p>

  const keyOfPane = new Map([...records.running].map(([key, paneId]) => [paneId, key]))
  const lines = new Map(records.history.map(s => [sessionKey(s), s]))
  const recordOf = (paneId: string) => {
    const key = keyOfPane.get(paneId)
    return key === undefined ? undefined : lines.get(key)
  }
  const found = (r: Row) => !needle || r.words.toLowerCase().includes(needle)
  const open = agentRows(project, recordOf).filter(found)
  const shells = shellRows(project).filter(found)
  const folding = foldOpen(open, earlierOpen || !!needle)
  const history = records.history.filter(
    s => !records.running.has(sessionKey(s)) && (!needle || matches(s, needle)),
  )
  const row = (id: string, own?: string) => ({
    shown: id === shown,
    to: href(id, own),
    onKeep: () => keep(id),
  })
  const read = records.recent !== undefined
  const count = open.length + shells.length + history.length
  const none = read && !count
  // Only herdr answering can say an agent is gone.
  const herdrKnows = machineOf(machines, project.mid)?.state.herdr.status === 'ready'
  const agents = new Set(
    projects.filter(p => p.mid === project.mid).flatMap(p => p.sessions.map(s => s.paneId)),
  )
  const ended = able && herdrKnows && !needle ? endedLoops(loops, project.path, agents) : []
  const paneRow = (r: Row) => (
    <PaneRow
      key={r.id}
      r={r}
      roots={roots}
      now={now}
      looping={able && loopOf(loops, r.paneId)?.enabled}
      needle={needle}
      link={row(r.id, r.query)}
      onTerminal={r.agent ? () => navigate(href(r.id, withTerminal('', true))) : undefined}
      onEnd={() => setEnding(r)}
    />
  )
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
        {needle && count && !records.busy ? (
          <p className="m-0 px-1 pt-1 text-[11.5px] text-faint">{t('sessions.found', { n: count })}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {records.error ? (
          <p className="m-2 text-[12.5px] text-danger">
            {t('sessions.failed', { msg: errorText(t, records.error) })}
          </p>
        ) : null}
        {open.length ? (
          <Group title={t('sessions.open')} count={open.length}>
            {folding.shown.map(paneRow)}
            {folding.more && !needle ? <FoldButton open={earlierOpen} more={folding.more} /> : null}
          </Group>
        ) : null}
        {ended.length ? (
          <Group title={t('sessions.endedLoops')} count={ended.length}>
            {ended.map(loop => (
              <EndedLoop key={loop.id} mid={project.mid} loop={loop} />
            ))}
          </Group>
        ) : null}
        <SessionsHistory
          mid={project.mid}
          history={history}
          needle={needle}
          now={now}
          branchOf={cwd => branchOf(roots, cwd)}
          row={row}
        />
        {!read && !open.length && !records.error ? <p className={NOTE}>{t('sessions.loading')}</p> : null}
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
        {shells.length ? (
          <Group title={t('sessions.shells')} count={shells.length}>
            {shells.map(paneRow)}
          </Group>
        ) : null}
      </div>
      {ending ? (
        <EndPane
          open
          onOpenChange={keepOpen => {
            if (!keepOpen) setEnding(undefined)
          }}
          mid={project.mid}
          paneId={ending.paneId}
          name={ending.herdrName ?? ending.paneId}
          machine={project.machine}
          path={project.display}
          agent={!!ending.agent}
          onEnded={() => {
            close(ending.id, shown === ending.id)
            setEnding(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

function FoldButton({ open, more }: { open: boolean; more: number }) {
  const t = useI18n()
  return (
    <button
      type="button"
      onClick={toggleEarlier}
      aria-expanded={open}
      className="mx-1 mt-px flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-text"
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {open ? t('sessions.fold') : t('sessions.earlier', { n: more })}
    </button>
  )
}
