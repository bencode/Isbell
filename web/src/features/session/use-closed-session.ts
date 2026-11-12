// A session that ran, wherever it is looked at: what was said in it as the agent recorded it, where
// it ran, and resuming it in a new pane there.

import { useEffect, useRef, useState } from 'react'
import { useChatLog } from '../../core/chat-log'
import { errorText, useI18n } from '../../core/i18n'
import { useRecordLookup, useSessionRecords } from '../../core/session-records'
import { useSpace, useSpaceView } from '../../core/space'
import { launchAgent, startAgent } from '../../model/herdr'
import type { Project } from '../../model/projects'
import { resumeArgs, sessionKey, under } from '../../model/sessions'
import { machineOf } from '../../model/space'
import { LAUNCH_METHOD } from '../../model/start-templates'

/** `onResumed`: the pane it now runs in. The session may be running again, in `pane`. `note`: what to
 * say while there is no `line`. */
export function useClosedSession(
  project: Project | undefined,
  mid: string,
  agent: string,
  sid: string,
  onResumed: (paneId: string) => void,
) {
  const t = useI18n()
  const space = useSpace()
  const records = useSessionRecords(project)
  const line = useRecordLookup()(mid, agent, sid)
  const log = useChatLog(mid, agent, line?.transcript, 'done')
  // Starting takes a while: what is done then is what would be done by then.
  const resumed = useRef(onResumed)
  useEffect(() => {
    resumed.current = onResumed
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Not among the latest: it may be in a month before.
  const { loadAll } = records
  const missing = records.recent !== undefined && !line
  useEffect(() => {
    if (missing) loadAll()
  }, [missing, loadAll])

  const reading = !project || !missing || records.more || records.busy
  const note = records.error
    ? t('sessions.failed', { msg: errorText(t, records.error) })
    : project && !project.online
      ? t('closed.offline')
      : reading
        ? t('board.loading')
        : t('closed.gone')

  const args = resumeArgs(agent, sid)
  // Started by a template's own command, it resumes by the same, which takes a gateway that types it.
  const launch = line?.launch
  const launches = !!machineOf(useSpaceView().machines, mid)?.state.caps.methods.includes(LAUNCH_METHOD)
  const cannot = !args
    ? t('closed.cannot', { agent })
    : !project?.online
      ? t('closed.offline')
      : launch && !launches
        ? t('closed.oldLaunch', { launch })
        : undefined
  const resume = async () => {
    if (!args || !line || busy || cannot) return
    setBusy(true)
    setError(undefined)
    try {
      const at = { cwd: line.cwd, kind: agent, args }
      const { paneId } = launch
        ? await launchAgent(space.call, mid, { ...at, command: launch })
        : await startAgent(space.call, mid, at)
      resumed.current(paneId)
    } catch (err) {
      setError(errorText(t, err))
      setBusy(false)
    }
  }
  const where =
    line && project && under(line.cwd, project.path)
      ? `${project.display}${line.cwd.slice(project.path.length)}`
      : (line?.cwd ?? '')

  return {
    line,
    log,
    note,
    pane: records.running.get(sessionKey({ agent, id: sid })),
    where,
    cannot,
    busy,
    error,
    resume,
  }
}
