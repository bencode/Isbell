// A project's recorded sessions, to resume: the latest by the day they were last active, then, asked
// for, the months before by when each began.

import { Link, useParams } from 'react-router'
import { Button } from '../../components/button'
import { errorText, type T, useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import type { Project } from '../../model/projects'
import { dayKey, type SessionRecord } from '../../model/sessions'
import { projectsSettled } from '../../model/space'
import { SessionRow } from './session-row'
import { useSessions } from './use-sessions'

const NOTE = 'm-6 flex flex-col items-start gap-3 text-muted'
const DAY_MS = 24 * 60 * 60 * 1000

export function SessionsPage() {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const { key } = useParams()
  const project = projects.find(p => p.key === key)

  // Until the projects settle, one not found may yet appear.
  if (!project)
    return projectsSettled(view) ? (
      <div className={NOTE}>
        <p className="m-0">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    ) : (
      <p className={NOTE}>{t('board.loading')}</p>
    )
  // Keyed, so the months read start over for each project.
  return <Sessions key={project.key} project={project} />
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function dayTitle(t: T, ms: number, now: number) {
  const day = dayKey(ms)
  if (day === dayKey(now)) return t('sessions.today')
  if (day === dayKey(now - DAY_MS)) return t('sessions.yesterday')
  return new Date(ms).toLocaleDateString([], { month: 'long', day: 'numeric' })
}

const monthTitle = (month: string) =>
  new Date(`${month}-01T00:00`).toLocaleDateString([], { year: 'numeric', month: 'long' })

/** The sessions in the order given, in runs of one day. */
const byDay = (sessions: SessionRecord[]) =>
  sessions.reduce<SessionRecord[][]>((days, s) => {
    const today = days.at(-1)
    if (today?.[0] && dayKey(today[0].updated) === dayKey(s.updated)) today.push(s)
    else days.push([s])
    return days
  }, [])

const GROUP =
  'm-0 list-none divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-raised p-0'
const TITLE = 'mt-4 mb-1.5 ml-0.5 text-xs font-semibold text-faint first:mt-0'

function Sessions({ project }: { project: Project }) {
  const t = useI18n()
  const { recent, error, running, older, more, busy, loadOlder } = useSessions(project)
  const now = Date.now()

  if (!recent)
    return (
      <p className={NOTE}>
        {error ? t('sessions.failed', { msg: errorText(t, error) }) : t('sessions.loading')}
      </p>
    )
  const shown = older.filter(m => m.lines.length)
  return (
    <main className="paper h-full overflow-auto px-7 pt-5 pb-10">
      <div className="flex max-w-[920px] flex-col">
        {error ? (
          <p className="m-0 mb-3 text-sm text-danger">{t('sessions.failed', { msg: errorText(t, error) })}</p>
        ) : null}
        {!recent.length && !shown.length && !more ? (
          <p className="m-0 text-muted">{t('sessions.empty')}</p>
        ) : null}
        {byDay(recent).map(day => (
          <section key={day[0]?.id}>
            <h2 className={TITLE}>{dayTitle(t, day[0]?.updated ?? now, now)}</h2>
            <ul className={GROUP}>
              {day.map(s => (
                <SessionRow
                  key={`${s.agent}-${s.id}`}
                  project={project}
                  session={s}
                  at={time(s.updated)}
                  pane={running.get(s.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {shown.map(m => (
          <section key={m.month}>
            <h2 className={TITLE}>{monthTitle(m.month)}</h2>
            <ul className={GROUP}>
              {m.lines.map(s => (
                <SessionRow
                  key={`${s.agent}-${s.id}`}
                  project={project}
                  session={s}
                  at={dateTime(s.started)}
                  pane={running.get(s.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {more ? (
          <Button className="mt-4 self-center" disabled={busy} onClick={loadOlder}>
            {t('sessions.more')}
          </Button>
        ) : null}
      </div>
    </main>
  )
}
