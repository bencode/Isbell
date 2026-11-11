// A session looked at without leaving the work on screen: a drawer over the workspace, showing it as
// its tab would. Who is looked at, and in which view, is in the address, in place: it goes with any
// address that leads elsewhere.

import { Dialog } from '@base-ui/react/dialog'
import { FolderPlus, Maximize2, SkipForward, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { IconButton } from '../../components/icon-button'
import { errorText, useI18n } from '../../core/i18n'
import { lastInTerminal } from '../../core/prefs'
import { useProjects, useSpace, useSpaceView } from '../../core/space'
import {
  type Found,
  lanes,
  locate,
  nextNeeding,
  type Placed,
  type Project,
  paneKey,
  type Session,
} from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { type Peek as Peeked, peekOf, sessionTabId, tabOf, withPeek } from '../../model/tabs'
import { isTab, sessionTabHref } from './tab-kinds'

const SMALL = { size: 14, strokeWidth: 1.5, absoluteStrokeWidth: true }

/** One that asks opens where it is answered; the rest as they were last viewed. */
export const opensInTerminal = ({ mid, paneId, status }: Session) =>
  status === 'blocked' || lastInTerminal(paneKey(mid, paneId))

// It brings the terminal, which loads with the first session looked at.
const SessionView = lazy(() =>
  import('../../features/session/session-view').then(m => ({ default: m.SessionView })),
)

export function usePeek() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const go = useCallback(
    (to: Peeked | null) => navigate({ pathname, search: withPeek(search, to) }, { replace: true }),
    [navigate, pathname, search],
  )
  /** Looks at a session; the tab on screen keeps its view unless the terminal is asked for. */
  const open = ({ session: { mid, paneId }, project }: Placed, terminal?: boolean) => {
    if (tabOf(search, isTab) !== sessionTabId(mid, paneId))
      go({ mid, paneId, terminal: terminal ?? lastInTerminal(paneKey(mid, paneId)) })
    else if (terminal) navigate(sessionTabHref(project.key, mid, paneId, true), { replace: true })
    else if (peekOf(search)) go(null)
  }
  return { peek: peekOf(search), search, go, open }
}

/** A directory run in but not listed, made one of its machine's projects. */
function AddAsProject({ project: { mid, path } }: { project: Project }) {
  const t = useI18n()
  const space = useSpace()
  const [problem, setProblem] = useState<string>()
  if (problem)
    return (
      <span title={problem} className="max-w-40 truncate text-danger">
        {problem}
      </span>
    )
  const add = () =>
    space
      .changeProjects(mid, paths => (paths?.includes(path) ? undefined : [...(paths ?? []), path]))
      .catch((err: unknown) => {
        console.error('could not add a project', err)
        setProblem(errorText(t, err))
      })
  return (
    <IconButton label={t('peek.addProject')} size="small" onClick={() => void add()}>
      <FolderPlus {...SMALL} />
    </IconButton>
  )
}

function Looking({ peek, found, go }: { peek: Peeked; found: Found; go: (to: Peeked | null) => void }) {
  const t = useI18n()
  const navigate = useNavigate()
  const { mid, paneId } = peek
  const next = nextNeeding(lanes(useProjects()), peek)?.session
  const other = next && !(next.mid === mid && next.paneId === paneId) ? next : undefined
  return (
    <SessionView
      mid={mid}
      paneId={paneId}
      found={found}
      terminal={peek.terminal}
      onShow={view => go({ ...peek, terminal: view === 'terminal' })}
      // No tab here to keep for it.
      onDraft={() => undefined}
      onEnded={() => go(null)}
      actions={
        <>
          {found.project.configured ? null : <AddAsProject project={found.project} />}
          <IconButton
            label={t('peek.next')}
            size="small"
            disabled={!other}
            onClick={() =>
              other && go({ mid: other.mid, paneId: other.paneId, terminal: opensInTerminal(other) })
            }
          >
            <SkipForward {...SMALL} />
          </IconButton>
          <IconButton
            label={t('peek.open')}
            size="small"
            onClick={() => navigate(sessionTabHref(found.project.key, mid, paneId, peek.terminal))}
          >
            <Maximize2 {...SMALL} />
          </IconButton>
          <Dialog.Close
            render={
              <IconButton label={t('peek.close')} size="small">
                <X {...SMALL} />
              </IconButton>
            }
          />
        </>
      }
    />
  )
}

/** `container`: the workspace, which it covers. */
export function Peek({ container }: { container: HTMLElement | null }) {
  const t = useI18n()
  const { peek, go } = usePeek()
  const projects = useProjects()
  const settled = projectsSettled(useSpaceView())
  const found = peek ? locate(projects, peek.mid, peek.paneId) : undefined
  const gone = peek !== null && !found && settled
  useEffect(() => {
    if (gone) go(null)
  }, [gone, go])
  if (!container) return null
  const inTerminal = peek?.terminal || (found !== undefined && 'shell' in found.pane)
  return (
    <Dialog.Root
      open={peek !== null && found !== undefined}
      // The cards stay in reach, to look at another.
      modal={false}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) return
        // There, Esc is the agent's: its menus take it.
        if (details.reason === 'escape-key' && inTerminal) details.cancel()
        else go(null)
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop
          className="absolute inset-0 z-20 bg-scrim transition-opacity duration-150 ease-out data-starting-style:opacity-0 motion-reduce:transition-none"
          onClick={() => go(null)}
        />
        <Dialog.Popup
          aria-label={t('peek.label')}
          className="absolute inset-y-0 right-0 z-20 flex w-[min(720px,100%)] flex-col border-l border-line bg-bg shadow-[-8px_0_24px_rgb(0_0_0/0.08)] outline-none transition-transform duration-200 ease-fold data-starting-style:translate-x-full motion-reduce:transition-none"
        >
          {peek && found ? (
            <Suspense>
              <Looking key={`${peek.mid}/${peek.paneId}`} peek={peek} found={found} go={go} />
            </Suspense>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
