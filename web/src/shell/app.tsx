import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '../components/button'
import { ErrorBoundary } from '../components/error-boundary'
import { useI18n } from '../core/i18n'
import { getLocal, updateLocal, useLocal } from '../core/prefs'
import { usePushSync } from '../core/push'
import { SpaceProvider, useProjects, useSpaceView } from '../core/space'
import { Join, takeKeyFromLink } from '../features/join/join-page'
import { Loading } from './common'
import { useNotifications } from './notify'

/** A phone gets its own shell, decided once at load; by the shorter side, so landscape counts too. */
const MOBILE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
if (MOBILE) {
  // Lets the phone's styles in styles.css apply.
  document.documentElement.dataset.shell = 'phone'
  // iOS shows :active only when the page listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true })
  // The boards put the page back where it was themselves (mobile/board.tsx).
  history.scrollRestoration = 'manual'
}

// `?shell=workbench` or `?shell=desktop` picks the frame on a computer, and is taken off the address.
const query = new URLSearchParams(location.search)
const asked = query.get('shell')
if (asked === 'workbench' || asked === 'desktop') {
  updateLocal(() => ({ shell: asked }))
  query.delete('shell')
  const rest = query.toString()
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
}

const workbench = !MOBILE && getLocal().shell === 'workbench'
// Lets the workbench's colors in styles.css apply.
if (workbench) document.documentElement.dataset.shell = 'workbench'

// Each shell is loaded only where it is used.
const Shell = lazy(() =>
  MOBILE
    ? import('./mobile/routes').then(m => ({ default: m.MobileRoutes }))
    : workbench
      ? import('./workbench/routes').then(m => ({ default: m.WorkbenchRoutes }))
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
  usePushSync()
  const rejected = view.status === 'rejected'
  useEffect(() => {
    if (rejected) onRejected()
  }, [rejected, onRejected])
  if (rejected) return null
  return (
    <ErrorBoundary fallback={<Broken />}>
      <Suspense fallback={<Loading />}>
        <Shell />
      </Suspense>
    </ErrorBoundary>
  )
}

/** In place of a page that failed, such as one whose code is gone after an update: only a reload
 * loads it again, so that is what it offers. */
function Broken() {
  const t = useI18n()
  return (
    <div className="m-6 flex flex-col items-start gap-3">
      <p className="m-0 text-muted">{t('app.broken')}</p>
      <Button onClick={() => location.reload()}>{t('app.reload')}</Button>
    </div>
  )
}
