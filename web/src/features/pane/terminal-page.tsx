// A pane in the browser: an agent's or a shell's, under full control. Leaving the page detaches;
// End closes the pane.

import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/button'
import { InfoFacts } from '../../components/info-panel'
import { errorText, useI18n } from '../../core/i18n'
import { attachCommand, connectionFacts, paneFacts } from '../../core/pane-facts'
import { RELAY_URL, useProjects, useSpace, useSpaceView } from '../../core/space'
import { type Found, locate, type Pane, type Project } from '../../model/projects'
import { projectsSettled, type Via } from '../../model/space'
import { projectHref } from '../../utils/hrefs'
import { TOUCH } from '../../utils/shortcuts'
import { useNow } from '../../utils/time'
import { EndPane } from './end-pane-dialog'
import { KeyBar } from './key-bar'
import type { PaneLayout } from './pane-layout'
import { useLink } from './use-link'
import { useTerminal } from './use-terminal'

/** `after`: where to go once the pane is ended or found gone; its project's board unless given. */
export function TerminalPage({ layout, after }: { layout: PaneLayout; after?: string }) {
  const t = useI18n()
  const params = useParams()
  const mid = params.mid ?? ''
  const paneId = params.pane ?? ''
  const space = useSpace()
  const view = useSpaceView()
  const found = locate(useProjects(), mid, paneId)

  const ready = projectsSettled(view)
  // Shells are pulled every so often; one opened a moment ago may not be listed yet.
  useEffect(() => {
    if (ready && !found) void space.refreshShells(mid)
  }, [ready, found, space, mid])

  // Until the projects settle, a pane not found may yet appear.
  if (!found && !ready) return <p className="m-6 text-muted">{t('board.loading')}</p>
  if (!found)
    return (
      <div className="m-6 flex flex-col items-start gap-3">
        <p className="m-0 text-muted">{t('terminal.gone')}</p>
        <Link to={after ?? '/'}>{t('project.back')}</Link>
      </div>
    )
  return (
    <Attached
      key={`${mid}/${paneId}`}
      layout={layout}
      mid={mid}
      paneId={paneId}
      found={found}
      after={after ?? projectHref(found.project.key)}
    />
  )
}

function Attached({
  layout: Layout,
  mid,
  paneId,
  found,
  after,
}: {
  layout: PaneLayout
  mid: string
  paneId: string
  found: Found
  after: string
}) {
  const t = useI18n()
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const { state, reconnect, press, ctrl, toggleCtrl } = useTerminal(box, mid, paneId)
  const [ending, setEnding] = useState(false)
  const { project, name, pane } = found
  const agent = 'session' in pane

  return (
    <>
      <Layout
        found={found}
        mid={mid}
        paneId={paneId}
        view="terminal"
        onEnd={() => setEnding(true)}
        facts={<TerminalFacts mid={mid} via={state.via} project={project} pane={pane} />}
      >
        <div className="relative min-h-0 flex-1 bg-term px-3 py-2">
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
        {TOUCH ? <KeyBar ctrl={ctrl} onCtrl={toggleCtrl} onKey={press} /> : null}
      </Layout>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={name}
        machine={project.machine}
        path={project.display}
        agent={agent}
        onEnded={() => navigate(after)}
      />
    </>
  )
}

/** The facts beside a terminal, with its direct link read again while they show. */
function TerminalFacts({
  mid,
  via,
  project,
  pane,
}: {
  mid: string
  via: Via | undefined
  project: Project
  pane: Pane
}) {
  const t = useI18n()
  const now = useNow()
  const relay = { url: RELAY_URL, status: useSpaceView().status }
  const link = useLink(mid, via)
  return (
    <InfoFacts
      groups={[
        ...paneFacts(t, now, project, pane),
        ...(via ? [connectionFacts(t, { via, relay, ...link })] : []),
      ]}
      command={{ label: t('facts.attach'), text: attachCommand(project, pane) }}
    />
  )
}
