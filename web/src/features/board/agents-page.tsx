// The board on a computer: every agent, or one project's, on the four lanes, with the plain shells
// at the foot of the standing one. `/` shows all of them; `/p/:key` the project's. A session opened from a
// card (`…/s/:mid/:pane`) shows beside the board, which folds into one column meanwhile; that column
// folds away too, leaving the session the whole width.

import { ChevronsLeft } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { Group, Panel, type PanelSize, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { Link, useParams } from 'react-router'
import { ResizeHandle } from '../../components/resize-handle'
import { useI18n } from '../../core/i18n'
import { useProjects, useSpaceView } from '../../core/space'
import { lanes, type Project } from '../../model/projects'
import { projectsSettled } from '../../model/space'
import { boardHref } from '../../utils/hrefs'
import { useKeptScroll } from '../../utils/kept-scroll'
import { useNow } from '../../utils/time'
import { BAR_ICON } from '../pane/pane-bar'
import { LanesFoldContext } from '../pane/peek-pane'
import { NoMachines } from './all-page'
import { Lanes } from './lanes'
import { type PeekTerminal, PeekViews } from './peek-views'

const NOTE = 'm-6 flex flex-col items-start gap-3 text-muted'

export function AgentsPage({ terminal }: { terminal: PeekTerminal }) {
  const t = useI18n()
  const view = useSpaceView()
  const projects = useProjects()
  const { key } = useParams()
  const project = key ? projects.find(p => p.key === key) : undefined

  if (!view.loaded) return <p className={NOTE}>{t('board.loading')}</p>
  if (!key && !view.machines.length) return <NoMachines />
  // Until the projects settle, one not found may yet appear.
  if (key && !project)
    return projectsSettled(view) ? (
      <div className={NOTE}>
        <p className="m-0">{t('project.gone')}</p>
        <Link to="/">{t('project.back')}</Link>
      </div>
    ) : (
      <p className={NOTE}>{t('board.loading')}</p>
    )
  // Keyed so the lanes start over for each project.
  return <Board key={project?.key ?? ''} project={project} all={projects} terminal={terminal} />
}

function Board({
  project,
  all,
  terminal,
}: {
  project: Project | undefined
  all: Project[]
  terminal: PeekTerminal
}) {
  const t = useI18n()
  const now = useNow()
  const { mid, pane } = useParams()
  const peek = !!(mid && pane)
  const scroll = useKeptScroll<HTMLElement>()
  const peekEl = useRef<HTMLDivElement>(null)
  const fold = useLanesFold(scroll.ref, peekEl)
  // The column's width beside a session, the same on every board.
  const split = useDefaultLayout({
    id: 'isbell.peek-split',
    panelIds: peek ? PANELS : ['lanes'],
    storage: localStorage,
  })
  const shown = project ? [project] : all
  const laneSet = lanes(shown)
  const asking = laneSet.asking.filter(p => p.session.mid !== mid || p.session.paneId !== pane).length
  const empty = !project ? t('all.empty') : project.online ? t('project.none') : t('project.offline')
  return (
    <div className="flex h-full flex-col">
      {/* Always the same panels first, so the lanes keep what is being written on them as a session
          opens and closes beside them. */}
      <Group
        orientation="horizontal"
        className={`min-h-0 flex-1 ${fold.moving ? 'motion-safe:[&>[data-panel]]:transition-[flex-grow] motion-safe:[&>[data-panel]]:duration-160 motion-safe:[&>[data-panel]]:ease-out' : ''}`}
        defaultLayout={split.defaultLayout}
        onLayoutChanged={split.onLayoutChanged}
      >
        <Panel
          id="lanes"
          className="flex"
          defaultSize={peek ? '360px' : '100%'}
          minSize="280px"
          collapsible
          collapsedSize="0px"
          panelRef={fold.panel}
          onResize={fold.onResize}
          groupResizeBehavior="preserve-pixel-size"
        >
          {/* Cut off rather than squeezed as it folds; out of reach of the keyboard once folded. */}
          <div
            className="relative flex min-w-0 flex-1 overflow-hidden"
            inert={fold.collapsed && !fold.moving}
          >
            {peek ? (
              <button
                ref={fold.foldButton}
                type="button"
                onClick={fold.fold}
                aria-expanded
                aria-label={t('peek.fold')}
                title={t('peek.fold')}
                className={`${BAR_ICON} absolute top-[7px] right-2 z-10 bg-bg`}
              >
                <ChevronsLeft size={16} />
              </button>
            ) : null}
            <main
              {...scroll}
              className={`paper flex min-h-0 min-w-[280px] flex-1 flex-col gap-5 overflow-auto pb-5 ${peek ? 'px-4 pt-11' : 'px-7 pt-5'}`}
            >
              {shown.some(p => p.sessions.length || p.shells.length) ? (
                <Lanes lanes={laneSet} now={now} stacked={peek} scoped={!!project} />
              ) : (
                <p className="m-0 text-muted">{empty}</p>
              )}
            </main>
          </div>
        </Panel>
        {peek ? (
          <>
            <ResizeHandle label={t('peek.resize')} disabled={fold.collapsed} />
            <Panel id="peek" className="flex" minSize="480px" elementRef={peekEl}>
              <LanesFoldContext
                value={{ folded: fold.collapsed && !fold.moving, asking, unfold: fold.unfold }}
              >
                <PeekViews terminal={terminal} after={boardHref(project?.key)} />
              </LanesFoldContext>
            </Panel>
          </>
        ) : null}
      </Group>
    </div>
  )
}

const PANELS = ['lanes', 'peek']

/** How long the lanes take to fold or unfold. */
const FOLD_MS = 160

/** Folding the lanes beside a session, by the panel's own collapse, so the layout saved for the
 * split keeps it too. Once they are done moving, the focus goes to the way back: the button on the
 * pane's bar (the one shown: the chat's and the terminal's may both be there), or the one on the
 * lanes, with the open card scrolled into sight. */
function useLanesFold(lanes: RefObject<HTMLElement | null>, peek: RefObject<HTMLElement | null>) {
  const panel = usePanelRef()
  const foldButton = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [moving, setMoving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Whether the move under way folds; null once its end is handled.
  const folding = useRef<boolean | null>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  // After the render that ends the move, so the bar's button is there.
  useEffect(() => {
    if (moving || folding.current === null) return
    if (folding.current) {
      const shown = [...(peek.current?.querySelectorAll<HTMLElement>('[data-unfold]') ?? [])]
      shown.find(el => el.checkVisibility())?.focus()
    } else {
      foldButton.current?.focus()
      lanes.current?.querySelector('a[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
    }
    folding.current = null
  }, [moving, lanes, peek])

  const move = (fold: boolean) => {
    folding.current = fold
    setMoving(true)
    if (fold) panel.current?.collapse()
    else panel.current?.expand()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMoving(false), FOLD_MS)
  }

  return {
    panel,
    foldButton,
    collapsed,
    moving,
    onResize: (size: PanelSize) => setCollapsed(size.inPixels === 0),
    fold: () => move(true),
    unfold: () => move(false),
  }
}
