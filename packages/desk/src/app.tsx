import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { useNotifications } from './notify'
import { AllProjects } from './pages/board/all'
import { BoardLayout } from './pages/board/layout'
import { ProjectView } from './pages/board/project'
import { Join, takeKeyFromLink } from './pages/join'
import { SessionPage } from './pages/session/page'
import { updateLocal, useLocal } from './prefs'
import { SpaceProvider, useProjects, useSpaceView } from './space'

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
      <Route element={<BoardLayout />}>
        <Route index element={<AllProjects />} />
        <Route path="p/:key" element={<ProjectView />} />
      </Route>
      <Route path="s/:mid/:pane" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
