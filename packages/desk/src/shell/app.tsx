import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { updateLocal, useLocal } from '../core/prefs'
import { SpaceProvider, useProjects, useSpaceView } from '../core/space'
import { AllProjects } from '../features/board/all-page'
import { ProjectView } from '../features/board/project-page'
import { Join, takeKeyFromLink } from '../features/join/join-page'
import { SessionPage } from '../features/session/session-page'
import { TerminalPage } from '../features/terminal/terminal-page'
import { AppFrame, BoardMain } from './frame'
import { useNotifications } from './notify'

export function App() {
  const { key } = useLocal()
  // A key from a link is offered on the join page rather than trusted silently.
  const [linked, setLinked] = useState(takeKeyFromLink)
  const [rejected, setRejected] = useState(false)
  if (!key || linked)
    return (
      <Join
        rejected={rejected}
        initial={linked}
        onJoined={() => {
          setLinked(null)
          setRejected(false)
        }}
      />
    )
  return (
    <SpaceProvider spaceKey={key}>
      <Connected
        onRejected={() => {
          setRejected(true)
          updateLocal(() => ({ key: null }))
        }}
      />
    </SpaceProvider>
  )
}

function Connected({ onRejected }: { onRejected: () => void }) {
  const view = useSpaceView()
  const projects = useProjects()
  useNotifications(projects, view.loaded)
  const rejected = view.status === 'rejected'
  useEffect(() => {
    if (rejected) onRejected()
  }, [rejected, onRejected])
  if (rejected) return null
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route element={<BoardMain />}>
          <Route index element={<AllProjects />} />
          <Route path="p/:key" element={<ProjectView />} />
        </Route>
        <Route path="s/:mid/:pane" element={<SessionPage />} />
        <Route path="t/:mid/:pane" element={<TerminalPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
