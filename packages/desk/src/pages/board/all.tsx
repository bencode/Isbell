import { needs } from '@isbell/core'
import { Link } from 'react-router'
import { useT } from '../../i18n'
import { useLocal } from '../../prefs'
import { projectHref } from '../../routes'
import { useProjects, useSpaceView } from '../../space'
import { useNow } from '../../time'
import { Command } from '../../ui/command'
import { Shells } from './project'
import { NeedsSection, SessionCard } from './session-card'

/** Each project shows this many sessions here; focusing it shows them all. */
const CAP = 6

export function AllProjects() {
  const t = useT()
  const view = useSpaceView()
  const projects = useProjects()
  const now = useNow()

  if (!view.loaded) return <p className="m-0 text-muted">{t('board.loading')}</p>
  if (!view.machines.length) return <NoMachines />

  const rows = needs(projects).map(session => ({
    session,
    project: projects.find(p => p.sessions.includes(session)),
  }))
  const online = view.machines.filter(m => m.online).length
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 text-[19px] font-semibold">{t('all.title')}</h1>
        <span className="text-muted">
          {t('all.summary', { projects: projects.length, machines: view.machines.length, online })}
        </span>
      </div>
      {rows.length ? <NeedsSection rows={rows} /> : <p className="m-0 text-muted">{t('all.nothing')}</p>}
      {projects.length ? null : <p className="m-0 text-muted">{t('all.empty')}</p>}
      {projects.map(p => (
        <section key={p.key} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="m-0 text-base font-semibold">
              <Link to={projectHref(p.key)} className="text-text no-underline hover:underline">
                {p.name}
              </Link>
            </h2>
            <span className="font-mono text-xs text-faint">{p.display}</span>
            <span className="rounded-md border border-line px-1.5 text-xs text-muted">{p.machine}</span>
            {p.sessions.length ? (
              <span className="text-sm text-faint">{t('all.live', { n: p.sessions.length })}</span>
            ) : null}
          </div>
          {p.sessions.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {p.sessions.slice(0, CAP).map(s => (
                <SessionCard key={s.paneId} session={s} now={now} />
              ))}
              {p.sessions.length > CAP ? (
                <Link
                  to={projectHref(p.key)}
                  className="flex min-h-28 items-center justify-center rounded-[10px] border border-dashed border-line text-[13px] text-muted no-underline hover:border-line-strong hover:text-text"
                >
                  {t('all.more', { n: p.sessions.length - CAP, name: p.name })}
                </Link>
              ) : null}
            </div>
          ) : null}
          <Shells project={p} />
        </section>
      ))}
    </>
  )
}

function NoMachines() {
  const t = useT()
  return (
    <div className="m-auto flex w-[min(620px,100%)] flex-col gap-3">
      <h1 className="m-0 text-xl font-semibold">{t('empty.title')}</h1>
      <p className="m-0 text-muted">{t('empty.body')}</p>
      <JoinCommands />
    </div>
  )
}

/** The two commands that add a machine to this space. */
export function JoinCommands() {
  const { key } = useLocal()
  return (
    <>
      <Command text={`isbell space join ${key}`} />
      <Command text="isbell gateway install" />
    </>
  )
}
