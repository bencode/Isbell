// A project's recorded sessions on a phone, scrolling with the page under a bar that leads back up to
// the project.

import { ChevronLeft } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { projectHref } from '../../utils/hrefs'
import { Loading, ReconnectBanner } from '../common'

// Loaded where it is used, as on a computer.
const SessionsPage = lazy(() =>
  import('../../features/sessions/sessions-page').then(m => ({ default: m.SessionsPage })),
)

export function PhoneSessions() {
  const t = useI18n()
  const { key = '' } = useParams()
  const project = useProjects().find(p => p.key === key)
  return (
    // The screen's height at least, so a short list does not scroll.
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex h-[52px] items-center gap-1 px-1.5">
          <Link
            to={projectHref(key)}
            aria-label={t('project.back')}
            className="inline-flex size-11 flex-none items-center justify-center rounded-lg text-accent active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronLeft size={24} />
          </Link>
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="flex-none text-base font-bold">{t('project.sessions')}</span>
            {project ? <span className="min-w-0 truncate text-xs text-faint">{project.name}</span> : null}
          </span>
        </div>
        <ReconnectBanner />
      </header>
      <Suspense fallback={<Loading />}>
        <SessionsPage phone />
      </Suspense>
    </div>
  )
}
