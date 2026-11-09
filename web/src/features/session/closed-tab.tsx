// What the tab of a session that ran shows: what was said in it, as the agent recorded it, where and
// when it ran, and resuming it, in a new pane where it ran, which takes the tab's place. A session
// running again shows as such.

import { type ReactNode, useEffect } from 'react'
import { type Params, useParams } from 'react-router'
import { Button } from '../../components/button'
import { errorText, type T, useI18n } from '../../core/i18n'
import { useProjects } from '../../core/space'
import { useTabActions } from '../../core/tabs'
import { parseRootKey } from '../../model/files/worktrees'
import { sessionTabId } from '../../model/tabs'
import { PathRoot } from './context'
import { Conversation, EarlierButton, Marker } from './conversation'
import { useClosedSession } from './use-closed-session'

const NOTE = 'm-6 text-muted'

const dateTime = (t: T, ms: number) =>
  new Date(ms).toLocaleString(t.locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  )
}

/** `params`: the machine, the agent and the session's id, from the tab's id. */
export function ClosedTabPane({
  id,
  params: { mid = '', agent = '', id: sid = '' },
}: {
  id: string
  params: Params
}) {
  const t = useI18n()
  // The tab is among its project's.
  const projectKey = parseRootKey(useParams().key ?? '').project
  const project = useProjects().find(p => p.key === projectKey)
  const { replace } = useTabActions()
  const { line, log, note, pane, where, cannot, busy, error, resume } = useClosedSession(
    project,
    mid,
    agent,
    sid,
    paneId => replace(id, sessionTabId(mid, paneId)),
  )
  useEffect(() => {
    if (pane) replace(id, sessionTabId(mid, pane))
  }, [pane, replace, id, mid])

  if (!project || !line) return <p className={NOTE}>{note}</p>

  const when =
    line.updated === undefined
      ? dateTime(t, line.started)
      : `${dateTime(t, line.started)} – ${dateTime(t, line.updated)}`
  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={busy || cannot !== undefined} onClick={() => void resume()}>
        {busy ? t('closed.resuming') : t('closed.resume')}
      </Button>
      {cannot ? <span className="text-[13px] text-muted">{cannot}</span> : null}
      {error ? <span className="text-[13px] text-danger">{t('closed.failed', { msg: error })}</span> : null}
    </div>
  )
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[34px] flex-none items-center gap-2.5 border-b border-line px-3 text-xs text-faint">
        <span className="size-2 flex-none rounded-full border border-faint" />
        <span className="min-w-0 truncate text-[13px] font-semibold text-text">{line.first}</span>
        <span className="flex-none">
          {agent} · {t('closed.ran')}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {log.turns ? (
          <div className="mx-auto flex w-full max-w-[760px] flex-col px-[22px] pt-[18px] pb-7">
            <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              {actions}
              <span className="text-[12.5px] text-faint">
                <span className="font-mono">{where}</span> · {when}
              </span>
            </div>
            <PathRoot value={{ project, cwd: line.cwd }}>
              <Conversation
                turns={log.turns}
                kind={agent}
                status="done"
                statusSince={0}
                top={
                  <Marker>
                    {log.start ? (
                      t('chat.start')
                    ) : (
                      <EarlierButton onClick={log.earlier} paging={log.paging} />
                    )}
                  </Marker>
                }
                asking={null}
              />
            </PathRoot>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-6 py-6">
            <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[13.5px]">
              <Fact label={t('closed.first')}>{line.first}</Fact>
              {line.last && line.last !== line.first ? (
                <Fact label={t('closed.last')}>{line.last}</Fact>
              ) : null}
              <Fact label={t('closed.where')}>
                <span className="font-mono text-[12.5px]">{where}</span>
              </Fact>
              <Fact label={t('closed.when')}>{when}</Fact>
            </dl>
            {actions}
            {log.unread ? <p className="m-0 text-[13px] text-muted">{t('chat.unreadRecord')}</p> : null}
            {log.error ? <p className="m-0 text-[13px] text-danger">{errorText(t, log.error)}</p> : null}
          </div>
        )}
      </div>
    </div>
  )
}
