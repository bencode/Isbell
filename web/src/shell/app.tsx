import { lazy, Suspense, useEffect, useState } from 'react'
import { updateLocal, useLocal } from '../core/prefs'
import { SpaceProvider, useProjects, useSpaceView } from '../core/space'
import { Join, takeKeyFromLink } from '../features/join/join-page'
import { Loading } from './common'
import { useNotifications } from './notify'

/** A phone gets its own shell, decided once at load; by the shorter side, so landscape counts too. */
const MOBILE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600

// Each shell is loaded only where it is used.
const Shell = lazy(() =>
  MOBILE
    ? import('./mobile/routes').then(m => ({ default: m.MobileRoutes }))
    : import('./desktop/routes').then(m => ({ default: m.DesktopRoutes })),
)

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
    <Suspense fallback={<Loading />}>
      <Shell />
    </Suspense>
  )
}
