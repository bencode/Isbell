import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { I18nProvider } from './core/i18n'
import { registerWorker } from './core/push'
import { reloadWhenChunksAreGone } from './core/stale-page'
import { messages } from './locales'
import { AGENTS_PATH } from './model/agent-share'
import { SHARE_PATH } from './model/share'
import { App } from './shell/app'
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles.css'

// A share link stands apart from the app, for someone who has no space here; so does the page that
// joins an agent share, which the app then shows.
const { pathname } = window.location
const SharePage = lazy(() => import('./shell/share/share-page').then(m => ({ default: m.SharePage })))
const JoinAgentsPage = lazy(() =>
  import('./shell/share/join-agents-page').then(m => ({ default: m.JoinAgentsPage })),
)
const Apart = pathname === SHARE_PATH ? SharePage : pathname === AGENTS_PATH ? JoinAgentsPage : undefined

if (!Apart) registerWorker()
reloadWhenChunksAreGone()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')
createRoot(root).render(
  <StrictMode>
    <I18nProvider messages={messages}>
      <BrowserRouter>
        {Apart ? (
          <Suspense>
            <Apart />
          </Suspense>
        ) : (
          <App />
        )}
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
