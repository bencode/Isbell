// A board on a phone, All projects or one project's, scrolling with the page: a bar that names it
// stays at the top, with the drawer on All projects and the way back up on a project, and New at
// its end, where it covers nothing. A project's other views are under its bar (project-facts.tsx).

import { ChevronLeft, Menu, Plus } from 'lucide-react'
import { useLayoutEffect } from 'react'
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
  useOutletContext,
  useParams,
} from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { needs } from '../../model/projects'
import { newHref } from '../../utils/hrefs'
import { ReconnectBanner } from '../common'
import { AskBadge } from '../marks'
import type { FrameActions } from './frame'
import { InstallTip } from './install-tip'

// A finger-sized icon button.
const ICON =
  'relative inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent'

// Where each visit to a board was left, by its entry in the history.
const scrolled = new Map<string, number>()

/** The page scrolls for every board, so a board opened anew starts at the top, and one gone back to
 * returns to where it was left. What is on it may still be coming in, so the page reaches for that
 * spot as it grows, until it gets there, the reader touches it, or a few seconds pass. */
function useEntryScroll() {
  const { key } = useLocation()
  const how = useNavigationType()
  useLayoutEffect(() => {
    const target = how === 'POP' ? (scrolled.get(key) ?? 0) : 0
    let reaching = true
    const grows = new ResizeObserver(() => reach())
    const stop = () => {
      reaching = false
      grows.disconnect()
    }
    const reach = () => {
      window.scrollTo(0, target)
      if (window.scrollY >= target - 1) stop()
    }
    // Not while reaching, when the page is still too short and the spot not yet where it was.
    const remember = () => {
      if (!reaching) scrolled.set(key, window.scrollY)
    }
    const giveUp = setTimeout(stop, 3000)
    grows.observe(document.body)
    reach()
    const passive = { passive: true }
    window.addEventListener('scroll', remember, passive)
    window.addEventListener('touchstart', stop, passive)
    window.addEventListener('wheel', stop, passive)
    return () => {
      stop()
      clearTimeout(giveUp)
      window.removeEventListener('scroll', remember)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('wheel', stop)
    }
  }, [key, how])
}

export function MobileBoard() {
  useEntryScroll()
  const t = useI18n()
  const { openDrawer } = useOutletContext<FrameActions>()
  const navigate = useNavigate()
  const view = useSpaceView()
  const projects = useProjects()
  const total = needs(projects).length
  const { key } = useParams()
  const inProject = key !== undefined
  const project = projects.find(p => p.key === key)
  const agents = projects.reduce((n, p) => n + p.sessions.length, 0)
  const online = view.machines.filter(m => m.online).length
  // A project's machine is in its facts, under the bar.
  const [title, sub] = inProject
    ? [project?.name, undefined]
    : [t('all.title'), view.machines.length ? t('all.short', { agents, online }) : undefined]
  return (
    // The screen's height at least, the paper filling what the bar leaves, so a short board does not
    // scroll.
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <div className="flex h-[52px] items-center gap-1 px-1.5">
          {inProject ? (
            <button
              type="button"
              onClick={() => navigate('/')}
              aria-label={t('project.back')}
              className={`${ICON} text-accent!`}
            >
              <ChevronLeft size={24} />
            </button>
          ) : (
            <button type="button" onClick={openDrawer} aria-label={t('side.projects')} className={ICON}>
              <Menu size={22} />
              {total ? (
                <AskBadge n={total} label={t('needs.title')} className="absolute top-1 right-0.5" />
              ) : null}
            </button>
          )}
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-base font-bold">{title}</span>
            {sub ? <span className="min-w-0 truncate text-xs text-faint">{sub}</span> : null}
          </span>
          <Link
            to={newHref(key)}
            className="inline-flex h-11 flex-none items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-accent no-underline active:bg-raised-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus size={18} />
            {t('app.newSession')}
          </Link>
        </div>
        <ReconnectBanner />
      </header>
      <main className="paper flex flex-1 flex-col gap-6 pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <InstallTip />
        <Outlet />
      </main>
    </div>
  )
}
