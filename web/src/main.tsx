import { StrictMode } from 'react'
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

registerWorker()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')
createRoot(root).render(
  <StrictMode>
    <I18nProvider messages={messages}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
