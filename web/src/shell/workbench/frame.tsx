// The frame on a computer. The projects are a fixed width, narrowing to their marks; a project's
// sessions and files, and each view of the right column, are dragged wider or folded away; the rest
// is the workspace. A fold button stays where it is as its own column moves: each hangs in the
// frame, not in a column.

import { Tooltip } from '@base-ui/react/tooltip'
import { ChevronsLeft, ChevronsRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import {
  Group,
  Panel,
  type PanelSize,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
} from 'react-resizable-panels'
import { ICON, IconButton } from '../../components/icon-button'
import { ResizeHandle } from '../../components/resize-handle'
import { useAgentSharesPull } from '../../core/agent-shares'
import { useBooksPull } from '../../core/books'
import { type Key, useI18n } from '../../core/i18n'
import {
  RIGHT_VIEWS,
  type RightView,
  setRightViews,
  toggledViews,
  toggleRail,
  useLocal,
} from '../../core/prefs'
import { type Overlay, Overlays } from '../../features/settings/settings-dialog'
import { ReconnectBanner } from '../reconnect-banner'
import { ActiveSessions, AgentsTools } from './active-sessions'
import { BAR } from './bar'
import { CommandPalette } from './command-palette'
import { ListColumn } from './list-column'
import { MessagesView } from './messages-view'
import { Peek } from './peek'
import { ProjectsRail } from './projects-rail'
import { RightBar } from './right-bar'
import { SettingsMenu } from './settings-menu'
import { TabStrip } from './tab-strip'
import { TasksView } from './tasks-view'
import { TabPanes } from './workspace'

/** Each right column: its title, what it shows, and what its bar offers beside the title. */
const VIEW_PARTS: Record<RightView, { title: Key; Body: () => ReactNode; Tools?: () => ReactNode }> = {
  agents: { title: 'workbench.agents', Body: ActiveSessions, Tools: AgentsTools },
  tasks: { title: 'workbench.tasks', Body: TasksView },
  messages: { title: 'workbench.messages', Body: MessagesView },
}
const PANELS = ['list', 'main', ...RIGHT_VIEWS]
const FOLD_MS = 200
// Narrow as anyone may want; dragged to half of this, a column folds.
const COLUMN_MIN = '100px'
const MAIN_MIN = '200px'
const FOLD_BUTTON = 'absolute top-[3px] z-10'
const MOVING =
  'motion-safe:[&>[data-panel]]:transition-[flex-grow] motion-safe:[&>[data-panel]]:duration-200 motion-safe:[&>[data-panel]]:ease-fold'

/** A column folded by the panel's own collapse, so the layout saved keeps it too. It opens to the
 * width it last settled at, so one dragged shut opens as wide as before the drag; folded when the
 * page loaded it has none, and opens to `base`. `sizeTo`, if given, sets its width in pixels in
 * place of the panel's own resize, which takes from the column beside it. */
function useFold(base: number, sizeTo?: (px: number) => void) {
  const panel = usePanelRef()
  const [folded, setFolded] = useState(false)
  const [moving, setMoving] = useState(false)
  const [width, setWidth] = useState(base)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    panel,
    base,
    folded,
    moving,
    width,
    onResize: (size: PanelSize) => setFolded(size.inPixels === 0),
    settle: () => {
      const size = panel.current?.getSize().inPixels
      if (size) setWidth(size)
    },
    toggle: () => {
      setMoving(true)
      const opening = panel.current?.isCollapsed() ?? false
      if (sizeTo) sizeTo(opening ? width : 0)
      else if (opening) panel.current?.resize(`${width}px`)
      else panel.current?.collapse()
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMoving(false), FOLD_MS)
    },
  }
}

type Fold = ReturnType<typeof useFold>

/** A column that folds: what is on it keeps its width as it goes, cut rather than squeezed, and is
 * out of reach of the keyboard once gone. `shut` starts it folded where no layout was saved. */
function FoldingColumn({
  id,
  fold,
  shut = false,
  children,
}: {
  id: string
  fold: Fold
  shut?: boolean
  children: ReactNode
}) {
  return (
    <Panel
      id={id}
      className="flex bg-side"
      defaultSize={shut ? '0px' : `${fold.base}px`}
      minSize={COLUMN_MIN}
      collapsible
      collapsedSize="0px"
      groupResizeBehavior="preserve-pixel-size"
      panelRef={fold.panel}
      onResize={fold.onResize}
    >
      <div className="flex min-w-0 flex-1 overflow-hidden" inert={fold.folded && !fold.moving}>
        <div
          className="flex min-w-0 flex-1 flex-col"
          style={{ minWidth: fold.moving ? fold.width : undefined }}
        >
          {children}
        </div>
      </div>
    </Panel>
  )
}

function Projects({ onOverlay }: { onOverlay: (overlay: Overlay) => void }) {
  const t = useI18n()
  const thin = useLocal().layout.rail
  return (
    <nav
      aria-label={t('side.projects')}
      className={`relative flex flex-none flex-col overflow-hidden border-r border-line bg-side transition-[width] duration-200 ease-fold motion-reduce:transition-none ${thin ? 'w-[52px]' : 'w-[196px]'}`}
    >
      <IconButton
        label={t(thin ? 'workbench.unfoldRail' : 'workbench.foldRail')}
        side="right"
        onClick={toggleRail}
        className={`${FOLD_BUTTON} left-3`}
      >
        {thin ? <ChevronsRight {...ICON} /> : <ChevronsLeft {...ICON} />}
      </IconButton>
      <div className={`${BAR} pl-12 font-semibold tracking-[-0.01em] ${thin ? 'text-transparent' : ''}`}>
        Isbell
      </div>
      <ProjectsRail thin={thin} />
      <div className="flex-none px-3 pt-1.5 pb-2.5">
        <SettingsMenu onOverlay={onOverlay} />
      </div>
    </nav>
  )
}

/** `inProject`: the address is in a project, whose tabs the workspace shows. */
export function Frame({ inProject }: { inProject: boolean }) {
  const t = useI18n()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null)
  const list = useFold(268)
  const group = useGroupRef()
  const main = usePanelRef()
  // A right column opens and folds against the workspace, whichever column stands beside it.
  const sizeTo = (view: RightView) => (px: number) => {
    const layout = group.current?.getLayout()
    const size = main.current?.getSize()
    if (!layout || !size?.inPixels) return
    const share = (px * size.asPercentage) / size.inPixels
    const delta = share - (layout[view] ?? 0)
    group.current?.setLayout({ ...layout, [view]: share, main: (layout.main ?? 0) - delta })
  }
  const columns: Record<RightView, Fold> = {
    agents: useFold(320, sizeTo('agents')),
    tasks: useFold(340, sizeTo('tasks')),
    messages: useFold(320, sizeTo('messages')),
  }
  const split = useDefaultLayout({ id: 'isbell.workbench', panelIds: PANELS, storage: localStorage })
  const moving = list.moving || RIGHT_VIEWS.some(v => columns[v].moving)
  const views = useLocal().layout.rightViews
  useBooksPull()
  useAgentSharesPull()
  // Each view is a column of its own, which opens and folds with it.
  const toggleView = (view: RightView) => {
    const opening = !views.includes(view)
    if (opening === (columns[view].panel.current?.isCollapsed() ?? false)) columns[view].toggle()
    setRightViews(toggledViews(views, view))
  }
  // The views open are the columns open: dragged shut, one closes, and as the page comes up they
  // agree with the layout saved.
  const agree = () => {
    const open = RIGHT_VIEWS.filter(v => columns[v].panel.current?.isCollapsed() === false)
    if (open.join() !== views.join()) setRightViews(open)
  }
  const agreed = useRef(false)
  useEffect(() => {
    if (agreed.current || RIGHT_VIEWS.some(v => !columns[v].panel.current)) return
    agreed.current = true
    agree()
  })
  return (
    <Tooltip.Provider delay={400} timeout={500}>
      <div className="flex h-full">
        <Projects onOverlay={setOverlay} />
        <div className="flex min-w-0 flex-1 flex-col">
          <ReconnectBanner />
          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <IconButton
                label={t(list.folded ? 'workbench.unfoldList' : 'workbench.foldList')}
                onClick={list.toggle}
                className={`${FOLD_BUTTON} left-2`}
              >
                {list.folded ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
              </IconButton>
              <Group
                orientation="horizontal"
                className={`h-full ${moving ? MOVING : ''}`}
                groupRef={group}
                defaultLayout={split.defaultLayout}
                onLayoutChanged={(layout, meta) => {
                  split.onLayoutChanged(layout, meta)
                  list.settle()
                  for (const view of RIGHT_VIEWS) columns[view].settle()
                  agree()
                }}
              >
                <FoldingColumn id="list" fold={list}>
                  <ListColumn />
                </FoldingColumn>
                <ResizeHandle label={t('workbench.resizeList')} disabled={list.folded} />
                <Panel
                  id="main"
                  className="flex"
                  minSize={MAIN_MIN}
                  panelRef={main}
                  // The library lets a panel scroll; this one's content scrolls inside it. Clipped, the
                  // peek's drawer taking focus as it slides in from past the edge cannot scroll it aside.
                  style={{ overflow: 'clip' }}
                >
                  <main ref={setWorkspace} className="relative flex min-w-0 flex-1 flex-col">
                    <div
                      className={`${BAR} bg-side transition-[padding] duration-200 ease-fold motion-reduce:transition-none ${list.folded ? 'pl-11' : ''}`}
                    >
                      {inProject ? <TabStrip edged={list.folded} /> : null}
                    </div>
                    {inProject ? <TabPanes /> : null}
                    <Peek container={workspace} />
                  </main>
                </Panel>
                {RIGHT_VIEWS.map(view => {
                  const { title, Body, Tools } = VIEW_PARTS[view]
                  const fold = columns[view]
                  return (
                    <Fragment key={view}>
                      <ResizeHandle label={t('workbench.resizeRight')} disabled={fold.folded} />
                      <FoldingColumn id={view} fold={fold} shut={!views.includes(view)}>
                        <div className={`${BAR} pr-2 pl-3.5 text-[13px] font-semibold`}>
                          {t(title)}
                          {Tools && !fold.folded && views.includes(view) ? (
                            <span className="ml-auto font-normal">
                              <Tools />
                            </span>
                          ) : null}
                        </div>
                        {fold.folded || !views.includes(view) ? null : <Body />}
                      </FoldingColumn>
                    </Fragment>
                  )
                })}
              </Group>
            </div>
            <RightBar onToggle={toggleView} />
          </div>
        </div>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} />
      <CommandPalette />
    </Tooltip.Provider>
  )
}
