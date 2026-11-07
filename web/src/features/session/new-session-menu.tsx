// Starting something in a project: one of the agents its machine has that Isbell chats with, or a
// plain shell, in the project's directory. Starting goes on with the menu closed, and leads to it.

import { Popover } from '@base-ui/react/popover'
import { Plus, SquareTerminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/icon-button'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace, useSpaceView } from '../../core/space'
import { CHAT_AGENTS } from '../../model/agents'
import { openShell, startAgent } from '../../model/herdr'
import type { Project } from '../../model/projects'
import { machineOf, type Space } from '../../model/space'

const SMALL = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true }
/** The choice that starts no agent. Agent kinds never contain ':'. */
const SHELL = ':shell'

/** Starts `kind` in the project's directory; the pane it runs in. */
async function start(space: Space, { mid, path }: Project, kind: string): Promise<string> {
  if (kind === SHELL) {
    const paneId = await openShell(space.openThenEnd, mid, path)
    await space.refreshShells(mid)
    return paneId
  }
  // In its regular mode pi leaves the conversation in the terminal's history, where the chat reads it.
  const args = kind === 'pi' ? { args: ['--tui-mode', 'regular'] } : {}
  return (await startAgent(space.call, mid, { cwd: path, kind, ...args })).paneId
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
  const kinds = [...(caps?.agentKinds.filter(k => CHAT_AGENTS.includes(k)) ?? []), SHELL]
  const [open, setOpen] = useState(false)
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

  const pick = async (kind: string) => {
    if (starting) return
    setStarting(kind)
    setError(undefined)
    try {
      const paneId = await start(space, project, kind)
      setOpen(false)
      if (live.current) onStarted(project.mid, paneId, kind === SHELL)
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
            {kinds.map(kind => (
              <button
                key={kind}
                type="button"
                disabled={!!starting}
                onClick={() => void pick(kind)}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-text outline-none enabled:hover:bg-raised focus-visible:bg-raised disabled:cursor-default disabled:text-faint"
              >
                {kind === SHELL ? <SquareTerminal {...SMALL} className="text-muted" /> : null}
                <span className={`flex-1 ${kind === SHELL ? '' : 'pl-6 font-mono'}`}>
                  {kind === SHELL ? t('info.terminal') : kind}
                </span>
                {starting === kind ? <span className="text-xs text-faint">{t('ns.starting')}</span> : null}
              </button>
            ))}
            {error ? <p className="m-0 px-2.5 py-1.5 text-xs text-danger">{error}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
