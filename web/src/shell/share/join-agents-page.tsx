// What someone opening an agent share's link sees: the agents shared, read live through the share's
// own space, and the one step that adds them to the Agents column of the app here, which then opens.

import { useLocation } from 'react-router'
import { Button } from '../../components/button'
import { StatusDot } from '../../components/status-dot'
import { useI18n } from '../../core/i18n'
import { joinShare, useLocal } from '../../core/prefs'
import { ProvideSpace, useProjects, useSpaceView } from '../../core/space'
import { keyOfAgentsHash } from '../../model/agent-share'
import { useShareSpace } from './share-page'

export function JoinAgentsPage() {
  const t = useI18n()
  const key = keyOfAgentsHash(useLocation().hash)
  const space = useShareSpace(key)
  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex h-9 flex-none items-center border-b border-line px-3.5 text-[13px]">
        <b className="text-[14px] font-bold">Isbell</b>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center p-4">
        {!key || space === null ? (
          <Note title={t('joinAgents.invalid')} />
        ) : space ? (
          <ProvideSpace space={space}>
            <Shared shareKey={key} />
          </ProvideSpace>
        ) : (
          <Note title={t('shared.connecting')} />
        )}
      </main>
    </div>
  )
}

function Shared({ shareKey }: { shareKey: string }) {
  const t = useI18n()
  const view = useSpaceView()
  const joined = useLocal().sharesJoined.includes(shareKey)
  const agents = useProjects()
    .filter(p => p.online)
    .flatMap(project => project.sessions.map(session => ({ session, project })))
  const machines = view.machines.filter(m => m.online)
  if (!view.loaded) return <Note title={t('shared.connecting')} />
  if (!machines.length) return <Note title={t('sharedWithMe.ended')} />
  const join = () => {
    joinShare(shareKey)
    window.location.replace('/')
  }
  return (
    <div className="flex w-[min(420px,100%)] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <b className="text-[15px] font-semibold">
          {agents.length === 1 ? t('joinAgents.titleOne') : t('joinAgents.title', { n: agents.length })}
        </b>
        <span className="text-[13px] text-muted">{t('joinAgents.what')}</span>
      </div>
      <div className="flex flex-col rounded-[10px] border border-line p-1.5">
        {machines.map(m => {
          const list = agents.filter(a => a.session.mid === m.state.machine.id)
          return list.length ? (
            <section key={m.state.machine.id}>
              <h4 className="m-0 px-2 pt-1.5 pb-0.5 text-[11px] font-semibold text-muted">
                {m.state.machine.name}
              </h4>
              {list.map(({ session, project }) => (
                <div key={session.paneId} className="flex items-center gap-2 px-2 py-[5px] text-[13px]">
                  <StatusDot status={session.status} />
                  <span className="min-w-0 truncate">{session.title ?? session.name}</span>
                  <span className="ml-auto truncate text-[11.5px] text-faint">{project.name}</span>
                </div>
              ))}
            </section>
          ) : null
        })}
        {agents.length ? null : (
          <p className="m-0 px-2 py-1.5 text-[13px] text-muted">{t('sharedWithMe.none')}</p>
        )}
      </div>
      <Button
        variant="primary"
        className="self-start"
        onClick={joined ? () => window.location.replace('/') : join}
      >
        {t(joined ? 'joinAgents.open' : 'joinAgents.join')}
      </Button>
    </div>
  )
}

function Note({ title }: { title: string }) {
  return <b className="text-[15px] font-semibold">{title}</b>
}
