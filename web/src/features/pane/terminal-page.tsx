// A pane in the browser: an agent's or a shell's, under full control. Leaving the page detaches;
// End closes the pane.

import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/button'
import { InfoPanel } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { useLocal } from '../../core/prefs'
import { RELAY_URL, useProjects, useSpace, useSpaceView } from '../../core/space'
import { type Found, locate } from '../../model/projects'
import { projectHref } from '../../utils/hrefs'
import { useNow } from '../../utils/time'
import { EndPane } from './end-pane-dialog'
import { PaneHeader } from './pane-header'
import { useLink } from './use-link'
import { useTerminal } from './use-terminal'

export function TerminalPage() {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const space = useSpace()
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)

  // Shells are pulled every so often; one opened a moment ago may not be listed yet.
  useEffect(() => {
    if (view.loaded && !found) void space.refreshShells(mid)
  }, [view.loaded, found, space, mid])

  if (!view.loaded) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!found)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('terminal.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    )
  return <Attached key={`${mid}/${paneId}`} mid={mid} paneId={paneId} found={found} />
}

function Attached({ mid, paneId, found }: { mid: string; paneId: string; found: Found }) {
  const t = useI18n()
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect } = useTerminal(box, mid, paneId)
  const [ending, setEnding] = useState(false)
  const { project, name, pane } = found
  const agent = 'session' in pane
  const now = useNow()
  const info = useLocal().layout.info
  const relay = { url: RELAY_URL, status: useSpaceView().status }
  const link = useLink(mid, state.via, info)
  const home = projectHref(project.key)

  return (
    <div className="flex h-full flex-col">
      <PaneHeader found={found} mid={mid} paneId={paneId} view="terminal" onEnd={() => setEnding(true)} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-term px-3 py-2">
          <div ref={box} className="h-full w-full bg-term" />
          {state.phase === 'ended' ? (
            <div className="absolute inset-0 grid place-items-center bg-scrim">
              <div className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-line bg-raised p-5 index-card-lifted">
                <p className="m-0 font-semibold">{t('terminal.ended')}</p>
                {state.error ? (
                  <p className="m-0 text-[13px] text-muted">{errorText(t, state.error)}</p>
                ) : null}
                <Button variant="primary" onClick={reconnect}>
                  {t('terminal.reconnect')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {info ? (
          <InfoPanel
            groups={[
              ...paneFacts(t, now, project, pane),
              ...(state.via ? [connectionFacts(t, { via: state.via, relay, ...link })] : []),
            ]}
            command={{ label: t('facts.attach'), text: attachCommand(project, pane) }}
          />
        ) : null}
      </div>
      <footer className="flex flex-none gap-4 border-t border-line px-4 py-1.5 font-mono text-xs text-faint">
        <span>
          {state.phase === 'opening' ? t('terminal.opening') : state.via ? t(`via.${state.via}`) : ''}
        </span>
        <span>{t('terminal.control')}</span>
        {state.size ? (
          <span>
            {state.size.cols}×{state.size.rows}
          </span>
        ) : null}
      </footer>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={name}
        machine={project.machine}
        path={project.display}
        agent={agent}
        onEnded={() => navigate(home)}
      />
    </div>
  )
}
