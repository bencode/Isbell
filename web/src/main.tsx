import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { I18nProvider } from './core/i18n'
import { registerWorker } from './core/push'
import { messages } from './locales'
import { App } from './shell/app'
import '@fontsource-variable/instrument-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles.css'

// A share link stands apart from the app, for someone who has no space here.
const watching = window.location.pathname === '/watch'
const WatchPage = lazy(() => import('./shell/watch/watch-page').then(m => ({ default: m.WatchPage })))

if (!watching) registerWorker()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')
createRoot(root).render(
  <StrictMode>
    <I18nProvider messages={messages}>
      {watching ? (
        <Suspense>
          <WatchPage />
        </Suspense>
      ) : (
        <BrowserRouter>
          <App />
        </BrowserRouter>
      )}
    </I18nProvider>
  </StrictMode>,
)
