import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { I18nProvider } from './core/i18n'
import { registerWorker } from './core/push'
import { reloadWhenChunksAreGone } from './core/stale-page'
import { messages } from './locales'
import { SHARE_PATH } from './model/share'
import { App } from './shell/app'
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles.css'

// A share link stands apart from the app, for someone who has no space here.
const sharing = window.location.pathname === SHARE_PATH
const SharePage = lazy(() => import('./shell/share/share-page').then(m => ({ default: m.SharePage })))

if (!sharing) registerWorker()
reloadWhenChunksAreGone()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')
createRoot(root).render(
  <StrictMode>
    <I18nProvider messages={messages}>
      <BrowserRouter>
        {sharing ? (
          <Suspense>
            <SharePage />
          </Suspense>
        ) : (
          <App />
        )}
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
