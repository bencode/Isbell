// One session's page: found from the address, then laid out around its parts (session-parts.tsx).
// A computer's scrolls inside the pane beside the board; a phone's scrolls with the page.

import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { type Project, paneKey, type Session } from '../../model/projects'
import { projectHref } from '../../utils/hrefs'
import { EndPane } from './end-pane-dialog'
import type { PaneLayout } from './pane-layout'
import { SessionBody, SessionDock, SessionFacts, useSession } from './session-parts'

// The reading column: as wide as the pane up to a wide screen, then centred.
const COLUMN = 'mx-auto w-full max-w-[1240px] px-4 sm:px-8'

/** A session found from the address; `after`, where to go once it is ended. */
export type FoundSession = { mid: string; paneId: string; project: Project; session: Session; after: string }

/** The session the address names, once the space has loaded and while it is there; `after`, where
 * to go once it is ended or found gone, its project's board unless given. */
export function SessionRoute({
  after,
  render,
}: {
  after?: string | undefined
  render: (found: FoundSession) => ReactNode
}) {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const view = useSpaceView()
  const projects = useProjects()
  const project = projects.find(p => p.mid === mid && p.sessions.some(s => s.paneId === paneId))
  const session = project?.sessions.find(s => s.paneId === paneId)

  if (!view.loaded) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!project || !session)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('session.gone')}</p>
        <Link to={after ?? '/'}>{t('project.back')}</Link>
      </div>
    )
  // Keyed, so moving to another session starts its page over instead of showing this one's screen.
  return (
    <Fragment key={paneKey(mid, paneId)}>
      {render({ mid, paneId, project, session, after: after ?? projectHref(project.key) })}
    </Fragment>
  )
}

/** A session's page on a computer, laid out by `layout`. */
export function SessionPage({ layout, after }: { layout: PaneLayout; after?: string }) {
  return <SessionRoute after={after} render={found => <SessionView layout={layout} {...found} />} />
}

function SessionView({
  layout: Layout,
  mid,
  paneId,
  project,
  session,
  after,
}: FoundSession & { layout: PaneLayout }) {
  const navigate = useNavigate()
  const [ending, setEnding] = useState(false)
  const state = useSession(mid, paneId, session)
  const { reading, text } = state

  // The page follows what comes in while it is scrolled to the end.
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if ((reading || text !== null) && el && pinned.current) el.scrollTop = el.scrollHeight
  }, [reading, text])

  const parts = { mid, paneId, project, session, state }
  return (
    <>
      <Layout
        found={{ project, name: session.name, pane: { session } }}
        mid={mid}
        paneId={paneId}
        view="chat"
        onEnd={() => setEnding(true)}
        facts={<SessionFacts mid={mid} project={project} session={session} />}
      >
        <div
          ref={scroller}
          onScroll={e => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="paper min-h-0 flex-1 overflow-auto"
        >
          <div className={`${COLUMN} flex flex-col gap-3.5 pt-5 pb-7`}>
            <SessionBody {...parts} />
          </div>
        </div>
        <div className="flex-none border-t border-line bg-bg">
          <div className={`${COLUMN} pt-3 pb-3.5`}>
            <SessionDock {...parts} />
          </div>
        </div>
      </Layout>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={session.name}
        machine={project.machine}
        path={project.display}
        agent
        onEnded={() => navigate(after)}
      />
    </>
  )
}
