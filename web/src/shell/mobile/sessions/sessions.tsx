// A project's sessions on a phone, one project at a time as their records are read: by the day they
// were last active, or flat as found. One running opens as it runs; one that ended, as it was left.

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { errorText, type T, useI18n } from '../../../core/i18n'
import { setSessionsProject, useLocal } from '../../../core/prefs'
import { useSessionRecords } from '../../../core/session-records'
import { useProjects, useSpaceView } from '../../../core/space'
import { useFilesRoots } from '../../../core/worktrees'
import { Marked } from '../../../features/session/session-row'
import { rootHolding } from '../../../model/files/worktrees'
import type { Project } from '../../../model/projects'
import { byDay, excerpt, lineTime, matches, type SessionLine, sessionKey } from '../../../model/sessions'
import { projectsSettled } from '../../../model/space'
import { endedHref, sessionHref } from '../../../utils/hrefs'
import { clock, dayTitle, useNow } from '../../../utils/time'
import { BackButton, BarTitle, PhoneBar } from '../bar'
import { SearchField } from '../files/search'
import { usePlaceKept } from '../page-place'
import { ProjectSheet } from './project-sheet'

const NOTE = 'm-0 px-4 py-3 text-[13px] text-muted'

const dayOf = (t: T, ms: number, now: number) =>
  dayTitle(t.locale, ms, now, { today: t('sessions.today'), yesterday: t('sessions.yesterday') })

export function PhoneSessions() {
  usePlaceKept('sessions')
  const t = useI18n()
  const settled = projectsSettled(useSpaceView())
  const { sessionsProject } = useLocal().layout
  const listed = useProjects().filter(p => p.path)
  // The one last looked at here; at first, the one last active, once all are known to choose from.
  const project =
    listed.find(p => p.key === sessionsProject) ??
    (settled
      ? listed.filter(p => p.online).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0]
      : undefined)
  // In the address, for a search to be there on coming back to it; and here, as the router's updates
  // come too late for what is being typed.
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const search = (q: string) => {
    setQuery(q)
    setParams(q ? { q } : {}, { replace: true })
  }
  const pick = (next: Project) => {
    setSessionsProject(next.key)
    search('')
    window.scrollTo(0, 0)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar
        under={
          project ? (
            <div className="flex gap-1.5 px-2.5 pb-2">
              <ProjectSheet projects={listed} current={project} onPick={pick} />
              <SearchField value={query} onChange={search} placeholder={t('sessions.search')} />
            </div>
          ) : undefined
        }
      >
        <BackButton />
        <BarTitle title={t('workbench.sessions')} where={project?.machine ?? ''} />
      </PhoneBar>
      <main className="min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        {project ? (
          <Listing key={project.key} project={project} needle={query.trim().toLowerCase()} />
        ) : (
          <p className={NOTE}>{t(settled ? 'mobile.noProject' : 'board.loading')}</p>
        )}
      </main>
    </div>
  )
}

function Listing({ project, needle }: { project: Project; needle: string }) {
  const t = useI18n()
  const now = useNow()
  const records = useSessionRecords(project)
  const { roots } = useFilesRoots(project)
  const { loadAll } = records
  useEffect(() => {
    if (needle) loadAll()
  }, [needle, loadAll])

  const found = records.history.filter(s => !needle || matches(s, needle))
  const inWords = (text: string) => text.toLowerCase().includes(needle)
  const row = (s: SessionLine, time: string) => {
    const pane = records.running.get(sessionKey(s))
    const root = rootHolding(roots, s.cwd)?.root
    // Found by something other than what it was first asked: what it was found by.
    const by = needle && !inWords(s.first) ? [s.last ?? '', s.cwd].find(inWords) : undefined
    return (
      <Link
        key={sessionKey(s)}
        to={pane ? sessionHref(project.mid, pane) : endedHref(project.key, s.agent, s.id)}
        className="flex min-h-[62px] flex-col justify-center border-b border-line px-4 py-2 text-inherit no-underline active:bg-press"
      >
        <b className="truncate text-[15px] leading-[1.35] font-medium">
          <Marked text={s.first} needle={needle} />
        </b>
        {by ? (
          <span className="truncate text-xs leading-[1.4] text-faint">
            <Marked text={excerpt(by, needle)} needle={needle} />
          </span>
        ) : null}
        <span className="flex min-w-0 items-center gap-[5px] text-xs leading-[1.4] text-faint">
          {pane ? <span className="size-[7px] flex-none rounded-full bg-ok" /> : null}
          <span className="flex-none">
            {s.agent} · {pane ? t('sessions.running') : time}
          </span>
          {root && !root.own && root.branch ? (
            <span className="truncate font-mono text-[11.5px]">· {root.branch}</span>
          ) : null}
        </span>
      </Link>
    )
  }
  const read = records.recent !== undefined

  return (
    <>
      {!project.online ? (
        <p className={NOTE}>{t('closed.offline')}</p>
      ) : records.error ? (
        <p className={`${NOTE} text-danger`}>{t('sessions.failed', { msg: errorText(t, records.error) })}</p>
      ) : !read ? (
        <p className={NOTE}>{t('sessions.loading')}</p>
      ) : null}
      {needle ? (
        <>
          {found.length && !records.busy ? (
            <p className="m-0 px-4 pt-2.5 pb-1 text-[12.5px] text-faint">
              {t('sessions.found', { n: found.length })}
            </p>
          ) : null}
          {found.map(s => {
            const at = lineTime(s)
            return row(s, `${dayOf(t, at, now)} ${clock(t.locale, at)}`)
          })}
        </>
      ) : (
        byDay(found, lineTime).map(day => (
          <section key={lineTime(day[0])}>
            <h3 className="m-0 px-4 pt-3.5 pb-1 text-[12.5px] font-semibold text-muted">
              {dayOf(t, lineTime(day[0]), now)}
            </h3>
            {day.map(s => row(s, clock(t.locale, lineTime(s))))}
          </section>
        ))
      )}
      {read && project.online && !found.length && !records.more && !records.busy ? (
        <p className={NOTE}>{t(needle ? 'sessions.noMatch' : 'mobile.noSessions')}</p>
      ) : null}
      {needle && records.busy ? <p className={NOTE}>{t('sessions.loading')}</p> : null}
      {records.more && !needle ? (
        <button
          type="button"
          disabled={records.busy}
          onClick={records.loadOlder}
          className="block h-12 w-full cursor-pointer border-0 bg-transparent text-sm text-accent disabled:cursor-default disabled:opacity-50"
        >
          {t('sessions.more')}
        </button>
      ) : null}
    </>
  )
}
