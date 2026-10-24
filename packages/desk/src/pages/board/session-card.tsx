import type { Project, Session } from '@isbell/core'
import { Sparkle } from 'lucide-react'
import { Link } from 'react-router'
import { useT } from '../../i18n'
import { sessionHref } from '../../routes'
import { since, useNow } from '../../time'
import { buttonClass } from '../../ui/button'
import { StatusChip } from '../../ui/chip'

export function SessionCard({ session, now }: { session: Session; now: number }) {
  const asking = session.status === 'blocked'
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className={`flex min-h-28 flex-col gap-2 rounded-[10px] border p-3.5 text-text no-underline hover:border-line-strong ${asking ? 'border-ask-line bg-ask' : 'border-line bg-raised'}`}
    >
      <span className="flex items-center gap-2">
        <Sparkle size={14} className="flex-none text-faint" />
        <span className="min-w-0 truncate font-semibold">{session.name}</span>
        {session.unread ? <span className="size-2 flex-none rounded-full bg-ok" aria-hidden="true" /> : null}
        <StatusChip status={session.status} />
        <span className="ml-auto flex-none text-xs text-faint">{since(session.statusSince, now)}</span>
      </span>
      <span className="line-clamp-2 text-[13.5px] text-muted">
        {session.title ?? session.kind ?? session.paneId}
      </span>
    </Link>
  )
}

function NeedRow({
  session,
  project,
  now,
}: {
  session: Session
  project?: Project | undefined
  now: number
}) {
  const t = useT()
  const asking = session.status === 'blocked'
  return (
    <Link
      to={sessionHref(session.mid, session.paneId)}
      className="flex items-center gap-3 border-line px-4 py-2.5 text-text no-underline hover:bg-raised-2 [&+&]:border-t"
    >
      <StatusChip status={session.status} />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold">{session.name}</b>
        {session.title ? <span className="text-muted"> · {session.title}</span> : null}
      </span>
      {project ? (
        <span className="flex-none text-xs text-faint">
          {project.name} · {project.machine}
        </span>
      ) : null}
      <span className="w-8 flex-none text-right text-xs text-faint">{since(session.statusSince, now)}</span>
      <span className={buttonClass('default', '', 'small')}>
        {asking ? t('needs.answer') : t('needs.see')}
      </span>
    </Link>
  )
}

export function NeedsSection({ rows }: { rows: { session: Session; project?: Project | undefined }[] }) {
  const t = useT()
  const now = useNow()
  if (!rows.length) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 flex items-baseline gap-2 text-base font-semibold">
        {t('needs.title')} <span className="text-sm font-normal text-faint">{rows.length}</span>
      </h2>
      <div className="overflow-hidden rounded-[10px] border border-line bg-raised">
        {rows.map(({ session, project }) => (
          <NeedRow key={`${session.mid}/${session.paneId}`} session={session} project={project} now={now} />
        ))}
      </div>
    </section>
  )
}
