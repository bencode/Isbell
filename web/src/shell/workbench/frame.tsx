// The frame on a computer: four columns. The projects are a fixed width, narrowing to their marks; a
// project's sessions and files, and the right column, are dragged wider or folded away; the rest is
// the workspace. A fold button stays where it is as its own column moves: each hangs in the frame,
// not in a column.

import { Tooltip } from '@base-ui/react/tooltip'
import {
  ChevronsLeft,
  ChevronsRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Group, Panel, type PanelSize, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { Button } from '../../components/button'
import { ICON, IconButton } from '../../components/icon-button'
import { ResizeHandle } from '../../components/resize-handle'
import { useI18n } from '../../core/i18n'
import { toggleRail, useLocal } from '../../core/prefs'
import { useSpace, useSpaceView } from '../../core/space'
import { ActiveSessions } from './active-sessions'
import { BAR } from './bar'
import { CommandPalette } from './command-palette'
import { ListColumn } from './list-column'
import { Peek } from './peek'
import { ProjectsRail } from './projects-rail'
import { type Overlay, Overlays, SettingsMenu } from './settings-menu'
import { TabStrip } from './tab-strip'
import { TabPanes } from './workspace'

const PANELS = ['list', 'main', 'right']
const FOLD_MS = 200
// Narrow as anyone may want; dragged to half of this, a column folds.
const COLUMN_MIN = '100px'
const MAIN_MIN = '200px'
const FOLD_BUTTON = 'absolute top-[7px] z-10'
const MOVING =
  'motion-safe:[&>[data-panel]]:transition-[flex-grow] motion-safe:[&>[data-panel]]:duration-200 motion-safe:[&>[data-panel]]:ease-fold'

/** A column folded by the panel's own collapse, so the layout saved keeps it too. It opens to the
 * width it last settled at, so one dragged shut opens as wide as before the drag; folded when the
 * page loaded it has none, and opens to `base`. */
function useFold(base: number) {
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
      if (panel.current?.isCollapsed()) panel.current.resize(`${width}px`)
      else panel.current?.collapse()
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMoving(false), FOLD_MS)
    },
  }
}

type Fold = ReturnType<typeof useFold>

/** A column that folds: what is on it keeps its width as it goes, cut rather than squeezed, and is
 * out of reach of the keyboard once gone. */
function FoldingColumn({ id, fold, children }: { id: string; fold: Fold; children: ReactNode }) {
  return (
    <Panel
      id={id}
      className="flex bg-side"
      defaultSize={`${fold.base}px`}
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

/** The strip shown while the relay reconnects, with a way to try at once. */
function ReconnectBanner() {
  const t = useI18n()
  const space = useSpace()
  const { status } = useSpaceView()
  if (status !== 'reconnecting') return null
  return (
    <div className="flex h-9 flex-none items-center gap-3 border-b border-ask-line bg-ask px-5 text-[13px]">
      <span className="flex-1">{t('banner.reconnecting')}</span>
      <Button size="small" onClick={space.reconnectNow}>
        {t('banner.now')}
      </Button>
    </div>
  )
}

/** `inProject`: the address is in a project, whose tabs the workspace shows. */
export function Frame({ inProject }: { inProject: boolean }) {
  const t = useI18n()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null)
  const list = useFold(268)
  const right = useFold(320)
  const split = useDefaultLayout({ id: 'isbell.workbench', panelIds: PANELS, storage: localStorage })
  const moving = list.moving || right.moving
  return (
    <Tooltip.Provider delay={400} timeout={500}>
      <div className="flex h-full">
        <Projects onOverlay={setOverlay} />
        <div className="flex min-w-0 flex-1 flex-col">
          <ReconnectBanner />
          <div className="relative min-h-0 flex-1">
            <IconButton
              label={t(list.folded ? 'workbench.unfoldList' : 'workbench.foldList')}
              onClick={list.toggle}
              className={`${FOLD_BUTTON} left-2`}
            >
              {list.folded ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
            </IconButton>
            <IconButton
              label={t(right.folded ? 'workbench.unfoldRight' : 'workbench.foldRight')}
              onClick={right.toggle}
              className={`${FOLD_BUTTON} right-2`}
            >
              {right.folded ? <PanelRightOpen {...ICON} /> : <PanelRightClose {...ICON} />}
            </IconButton>
            <Group
              orientation="horizontal"
              className={`h-full ${moving ? MOVING : ''}`}
              defaultLayout={split.defaultLayout}
              onLayoutChanged={(layout, meta) => {
                split.onLayoutChanged(layout, meta)
                list.settle()
                right.settle()
              }}
            >
              <FoldingColumn id="list" fold={list}>
                <ListColumn />
              </FoldingColumn>
              <ResizeHandle label={t('workbench.resizeList')} disabled={list.folded} />
              <Panel id="main" className="flex" minSize={MAIN_MIN}>
                <main ref={setWorkspace} className="relative flex min-w-0 flex-1 flex-col">
                  <div
                    className={`${BAR} bg-side transition-[padding] duration-200 ease-fold motion-reduce:transition-none ${list.folded ? 'pl-11' : ''} ${right.folded ? 'pr-11' : ''}`}
                  >
                    {inProject ? <TabStrip edged={list.folded} /> : null}
                  </div>
                  {inProject ? <TabPanes /> : null}
                  <Peek container={workspace} />
                </main>
              </Panel>
              <ResizeHandle label={t('workbench.resizeRight')} disabled={right.folded} />
              <FoldingColumn id="right" fold={right}>
                <div className={`${BAR} pr-11 pl-3.5 text-[13px] font-semibold`}>{t('workbench.active')}</div>
                {right.folded ? null : <ActiveSessions />}
              </FoldingColumn>
            </Group>
          </div>
        </div>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} />
      <CommandPalette />
    </Tooltip.Provider>
  )
}
