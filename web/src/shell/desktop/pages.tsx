// The pages on a computer, each the first tab of the window. They are given their location rather
// than reading the address, which also names the tab shown over them. The board, a project's
// sessions and its files stay as they were while another page shows, each at the address it was last shown at. A
// pane's terminal opens beside the board; its own address (`/t/…`, which links shared with the phone
// use) leads there.

import { Activity, lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { type Location, matchPath, Navigate, type Params, Route, Routes } from 'react-router'
import { AgentsPage } from '../../features/board/agents-page'
import { PeekPane } from '../../features/pane/peek-pane'
import { peekTerminalHref } from '../../utils/hrefs'
import { LazyTerminal, Loading } from '../common'

// A project's files bring the same libraries as a pane's.
const ProjectFiles = lazy(() =>
  import('../../features/files/project-files').then(m => ({ default: m.ProjectFiles })),
)
const SessionsPage = lazy(() =>
  import('../../features/sessions/sessions-page').then(m => ({ default: m.SessionsPage })),
)

/** The pages kept while another shows: one of each, the last shown. */
type Slot = 'board' | 'files' | 'sessions'

const BOARD = ['/', '/s/:mid/:pane', '/p/:key', '/p/:key/s/:mid/:pane']
const FILES = '/p/:key/files/*'
const SESSIONS = '/p/:key/sessions'
const TERMINAL = '/t/:mid/:pane'

const slotOf = (pathname: string): Slot | null =>
  matchPath(FILES, pathname)
    ? 'files'
    : matchPath(SESSIONS, pathname)
      ? 'sessions'
      : BOARD.some(path => matchPath(path, pathname))
        ? 'board'
        : null

type Kept = Partial<Record<Slot, Location>>

const PeekTerminal = ({ after }: { after: string }) => <LazyTerminal layout={PeekPane} after={after} />

/** The location each kept page was last shown at: the same object while its address is the same,
 * so coming back to it neither remounts it nor gives it a new history key. Without a page, the board
 * stays shown as it was. */
function useKept(page: Location | null): { shown: Slot | null; kept: Kept } {
  const was = useRef<Kept>({})
  const shown = page ? slotOf(page.pathname) : was.current.board ? 'board' : null
  const last = shown && was.current[shown]
  const kept =
    page === null || shown === null
      ? was.current
      : {
          ...was.current,
          [shown]: last && last.pathname === page.pathname && last.search === page.search ? last : page,
        }
  useLayoutEffect(() => {
    was.current = kept
  })
  return { shown, kept }
}

/** The pane's terminal beside the board last shown, or every agent's. */
const besideTerminal = (board: Location | undefined, { mid = '', pane = '' }: Params) =>
  peekTerminalHref(board && matchPath('/p/:key/*', board.pathname)?.params.key, mid, pane)

export function PageRoutes({ location }: { location: Location }) {
  const terminal = matchPath(TERMINAL, location.pathname)?.params
  // On the way to the terminal, the board stays as it is, rather than hiding and reading every card
  // again as it shows.
  const { shown, kept } = useKept(terminal ? null : location)
  const mode = (slot: Slot) => (slot === shown ? 'visible' : 'hidden')
  return (
    <>
      {kept.board ? (
        <Activity mode={mode('board')}>
          <Routes location={kept.board}>
            {/* One page, so opening a session beside the board and closing it keeps the board as it is. */}
            {BOARD.map(path => (
              <Route key={path} path={path} element={<AgentsPage terminal={PeekTerminal} />} />
            ))}
          </Routes>
        </Activity>
      ) : null}
      {kept.files ? (
        <Activity mode={mode('files')}>
          <Routes location={kept.files}>
            <Route
              path={FILES}
              element={
                <Suspense fallback={<Loading />}>
                  <ProjectFiles />
                </Suspense>
              }
            />
          </Routes>
        </Activity>
      ) : null}
      {kept.sessions ? (
        <Activity mode={mode('sessions')}>
          <Routes location={kept.sessions}>
            <Route
              path={SESSIONS}
              element={
                <Suspense fallback={<Loading />}>
                  <SessionsPage />
                </Suspense>
              }
            />
          </Routes>
        </Activity>
      ) : null}
      {terminal ? <Navigate to={besideTerminal(kept.board, terminal)} replace /> : null}
      {shown === null && !terminal ? <Navigate to="/" replace /> : null}
    </>
  )
}
