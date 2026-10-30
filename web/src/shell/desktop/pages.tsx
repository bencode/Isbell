// The pages on a computer, each the first tab of the window. They are given their location rather
// than reading the address, which also names the tab shown over them. The board and a project's
// files stay as they were while another page shows, each at the address it was last shown at.

import { Activity, lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { type Location, matchPath, Navigate, Route, Routes } from 'react-router'
import { AgentsPage } from '../../features/board/agents-page'
import { LazyTerminal, Loading } from '../common'
import { DesktopPane } from './pane'

// A project's files bring the same libraries as a pane's.
const ProjectFiles = lazy(() =>
  import('../../features/files/project-files').then(m => ({ default: m.ProjectFiles })),
)

/** The pages kept while another shows: one of each, the last shown. */
type Slot = 'board' | 'files'

const BOARD = ['/', '/s/:mid/:pane', '/p/:key', '/p/:key/s/:mid/:pane']
const FILES = '/p/:key/files/*'

const slotOf = (pathname: string): Slot | null =>
  matchPath(FILES, pathname) ? 'files' : BOARD.some(path => matchPath(path, pathname)) ? 'board' : null

type Kept = Partial<Record<Slot, Location>>

/** The location each kept page was last shown at: the same object while its address is the same,
 * so coming back to it neither remounts it nor gives it a new history key. */
function useKept(page: Location): { shown: Slot | null; kept: Kept } {
  const was = useRef<Kept>({})
  const shown = slotOf(page.pathname)
  const last = shown && was.current[shown]
  const kept =
    shown === null
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

export function PageRoutes({ location }: { location: Location }) {
  const { shown, kept } = useKept(location)
  const mode = (slot: Slot) => (slot === shown ? 'visible' : 'hidden')
  return (
    <>
      {kept.board ? (
        <Activity mode={mode('board')}>
          <Routes location={kept.board}>
            {/* One page, so opening a session beside the board and closing it keeps the board as it is. */}
            {BOARD.map(path => (
              <Route key={path} path={path} element={<AgentsPage />} />
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
      {shown === null ? (
        <Routes location={location}>
          <Route path="t/:mid/:pane" element={<LazyTerminal layout={DesktopPane} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : null}
    </>
  )
}
