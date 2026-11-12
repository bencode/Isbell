// Starting something in a project: one of its machine's start templates, or a plain shell, in the
// project's directory. Starting goes on with the menu closed, and leads to it.

import { Popover } from '@base-ui/react/popover'
import { Plus, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/icon-button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace, useSpaceView } from '../../core/space'
import { useTemplates } from '../../core/start-templates'
import { launchAgent, openShell, startAgent } from '../../model/herdr'
import type { Project } from '../../model/projects'
import { machineOf, type Space } from '../../model/space'
import { newArgs, plain, type StartTemplate, startCall, usable } from '../../model/start-templates'

const SMALL = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true }
/** The shell's key among the choices: no template has an empty name. */
const SHELL = ''
const ROW =
  'flex cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-text outline-none enabled:hover:bg-raised focus-visible:bg-raised disabled:cursor-default disabled:text-faint'

/** What to start: a template, or a plain shell. */
export type Choice = { template: StartTemplate } | 'shell'

/** Starts `choice` in the project's directory; the pane it runs in, and whether that is a shell: one
 * asked for, or one whose command herdr did not see an agent come up from. */
export async function startIn(
  space: Space,
  { mid, path }: Project,
  choice: Choice,
): Promise<{ paneId: string; shell: boolean }> {
  if (choice === 'shell') {
    const paneId = await openShell(space.openThenEnd, mid, path)
    await space.refreshShells(mid)
    return { paneId, shell: true }
  }
  const call = startCall(choice.template, path, newArgs(choice.template.agent))
  if (call.method === 'isbell.agent.start')
    return { paneId: (await startAgent(space.call, mid, call.p)).paneId, shell: false }
  const { paneId, recognized } = await launchAgent(space.call, mid, call.p)
  return { paneId, shell: !recognized }
}

/** `onStarted`: where to go once the pane is running; `shell`, it runs a shell rather than an agent. */
export function NewSessionMenu({
  project,
  onStarted,
}: {
  project: Project
  onStarted: (mid: string, paneId: string, shell: boolean) => void
}) {
  const t = useI18n()
  const space = useSpace()
  const caps = machineOf(useSpaceView().machines, project.mid)?.state.caps
  const [open, setOpen] = useState(false)
  const templates = useTemplates(project.mid, open)
  // Those of agents herdr knows there; one this machine's gateway cannot start shows why.
  const shown = templates.filter(tm => caps?.agentKinds.includes(tm.agent))
  const [starting, setStarting] = useState<string>()
  const [error, setError] = useState<string>()
  const startable = project.online && !!project.path
  // Gone to another project while starting: the pane shows in this one's list, without leading back.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const pick = async (choice: Choice, key: string) => {
    if (starting !== undefined) return
    setStarting(key)
    setError(undefined)
    try {
      const { paneId, shell } = await startIn(space, project, choice)
      setOpen(false)
      if (live.current) onStarted(project.mid, paneId, shell)
    } catch (err) {
      setError(errorText(t, err))
      // Closed meanwhile, it opens again to say so.
      if (live.current) setOpen(true)
    } finally {
      setStarting(undefined)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={!startable}
        render={
          <IconButton label={t('session.new')} size="small">
            <Plus {...SMALL} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50 outline-none">
          <Popover.Popup className="flex w-60 flex-col gap-0.5 rounded-lg border border-line bg-raised-2 p-1.5 text-[13px] index-card-lifted outline-none">
            <p className="m-0 truncate px-2.5 pt-1 pb-1.5 text-xs text-faint" title={project.display}>
              {t('session.startIn', { path: project.display })}
            </p>
            {shown.map(tm => {
              const able = !!caps && usable(tm, caps)
              return (
                <button
                  key={tm.name}
                  type="button"
                  disabled={starting !== undefined || !able}
                  title={able ? tm.command : t('templates.old')}
                  onClick={() => void pick({ template: tm }, tm.name)}
                  className={ROW}
                >
                  <span className={`min-w-0 flex-1 truncate pl-6 ${plain(tm) ? 'font-mono' : ''}`}>
                    {tm.name}
                  </span>
                  {plain(tm) ? null : <span className="font-mono text-xs text-faint">{tm.agent}</span>}
                  {starting === tm.name ? (
                    <span className="text-xs text-faint">{t('ns.starting')}</span>
                  ) : null}
                </button>
              )
            })}
            <button
              type="button"
              disabled={starting !== undefined}
              onClick={() => void pick('shell', SHELL)}
              className={ROW}
            >
              <SquareTerminal {...SMALL} className="text-muted" />
              <span className="flex-1">{t('info.terminal')}</span>
              {starting === SHELL ? <span className="text-xs text-faint">{t('ns.starting')}</span> : null}
            </button>
            {error ? <p className="m-0 px-2.5 py-1.5 text-xs text-danger">{error}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
