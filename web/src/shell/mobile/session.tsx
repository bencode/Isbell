// A session's page on a phone: the bar that names it and switches between its chat, which scrolls
// with the page, and its terminal, which is laid over it and attached only while shown.

import { ChevronLeft, Ellipsis } from 'lucide-react'
import { Activity, lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Modal } from '../../components/dialog'
import { DropdownMenu } from '../../components/menu'
import { Segmented } from '../../components/segmented'
import { StatusDot } from '../../components/status-dot'
import { useI18n } from '../../core/i18n'
import { usePaneSession } from '../../core/session-records'
import { ShowTerminal } from '../../features/session/context'
import { EndPane } from '../../features/session/end-pane-dialog'
import { PaneFacts } from '../../features/session/session-parts'
import type { View } from '../../features/session/subbar'
import { useFoundPane } from '../../features/session/use-found-pane'
import { type Found, placedTitle, placedWhere } from '../../model/projects'
import type { Via } from '../../model/space'
import { showsTerminal, withTerminal } from '../../model/tabs'
import { Loading } from '../loading'
import { PhoneBar, TAP, useBack } from './bar'
import { PhoneChat } from './chat'

// With xterm, which a chat alone does not need.
const PhoneTerminal = lazy(() => import('./terminal').then(m => ({ default: m.PhoneTerminal })))

export function PhoneSession() {
  const t = useI18n()
  const { mid = '', '*': paneId = '' } = useParams()
  const { found, waiting } = useFoundPane(mid, paneId)
  const { search } = useLocation()
  // Just started it is listed as a shell until its agent is made out, and it is the agent that was
  // asked for, not that shell's terminal.
  const starting = !!found && !('session' in found.pane) && new URLSearchParams(search).get('from') === 'new'
  if (found && !starting) return <Opened mid={mid} paneId={paneId} found={found} />
  return (
    <>
      <PhoneBar>
        <BackButton />
      </PhoneBar>
      <p className="m-0 p-4 text-muted">{t(waiting || starting ? 'board.loading' : 'session.gone')}</p>
    </>
  )
}

function BackButton() {
  const t = useI18n()
  const back = useBack()
  return (
    <button type="button" onClick={back} aria-label={t('mobile.back')} className={TAP}>
      <ChevronLeft size={22} />
    </button>
  )
}

function Opened({ mid, paneId, found }: { mid: string; paneId: string; found: Found }) {
  const t = useI18n()
  const navigate = useNavigate()
  const { search } = useLocation()
  const { project, pane } = found
  const agent = 'session' in pane ? pane.session : undefined
  const ran = usePaneSession(mid, paneId, agent?.kind, agent?.status)
  const placed = agent && { session: agent, project }
  // A pane just started is listed as a shell until its agent is made out.
  const shown: View = agent && !showsTerminal(search) ? 'chat' : 'terminal'
  // In place, so that back still leaves the session.
  const show = useCallback(
    (view: View) => navigate({ search: withTerminal(search, view === 'terminal') }, { replace: true }),
    [navigate, search],
  )
  const showTerminal = useCallback(() => show('terminal'), [show])
  // Come from a push or from New, one waiting for an answer opens where it is answered. Once:
  // answered, it stays.
  const status = agent?.status
  useLayoutEffect(() => {
    const params = new URLSearchParams(search)
    if (!params.has('from')) return
    params.delete('from')
    navigate({ search: withTerminal(params.toString(), status === 'blocked') }, { replace: true })
  }, [search, status, navigate])
  const [info, setInfo] = useState(false)
  const [ending, setEnding] = useState(false)
  const [via, setVia] = useState<Via>()

  const bar = (
    <PhoneBar>
      <BackButton />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[14.5px] leading-tight font-semibold">
          {placed ? placedTitle(placed) : found.name}
        </b>
        <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] leading-tight text-faint">
          {agent ? <StatusDot status={agent.status} /> : null}
          <span className="min-w-0 truncate">{placed ? placedWhere(placed) : project.display}</span>
        </span>
      </div>
      {agent ? (
        <Segmented
          label={t('session.view')}
          value={shown}
          onChange={show}
          segments={[
            { value: 'chat', label: t('session.chat') },
            { value: 'terminal', label: t('session.terminal') },
          ]}
        />
      ) : null}
      <DropdownMenu
        trigger={
          <button type="button" aria-label={t('mobile.more')} className={TAP}>
            <Ellipsis size={20} />
          </button>
        }
        items={[
          { label: t('session.info'), onClick: () => setInfo(true) },
          {
            label: t(agent ? 'end.confirm' : 'terminal.endConfirm'),
            onClick: () => setEnding(true),
            danger: true,
          },
        ]}
      />
    </PhoneBar>
  )

  return (
    <ShowTerminal value={showTerminal}>
      {shown === 'terminal' ? (
        <Suspense fallback={<Loading />}>
          <PhoneTerminal bar={bar} mid={mid} paneId={paneId} onVia={setVia} />
        </Suspense>
      ) : null}
      {/* Kept behind the terminal: a reply half written, what was just sent, and its place. */}
      {agent ? (
        <Activity mode={shown === 'chat' ? 'visible' : 'hidden'}>
          <div className="flex min-h-dvh flex-col">
            {bar}
            <PhoneChat project={project} session={agent} ran={ran} />
          </div>
        </Activity>
      ) : null}
      <Modal open={info} onOpenChange={setInfo} title={t('session.info')} closeLabel={t('close')}>
        {info ? (
          <PaneFacts mid={mid} project={project} pane={pane} via={shown === 'terminal' ? via : 'calls'} />
        ) : null}
      </Modal>
      <EndPane
        open={ending}
        onOpenChange={setEnding}
        mid={mid}
        paneId={paneId}
        name={agent?.name ?? paneId}
        machine={project.machine}
        path={project.display}
        agent={!!agent}
        onEnded={() => navigate('/', { replace: true })}
      />
    </ShowTerminal>
  )
}
