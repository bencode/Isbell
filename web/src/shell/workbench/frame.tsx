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
import { ResizeHandle } from '../../components/resize-handle'
import { useI18n } from '../../core/i18n'
import { toggleRail, useLocal } from '../../core/prefs'
import { type Overlay, Overlays, ReconnectBanner } from '../common'
import { ICON, IconButton } from './icon-button'
import { SettingsMenu } from './settings-menu'

const PANELS = ['list', 'main', 'right']
const FOLD_MS = 200
const BAR = 'flex h-[42px] flex-none items-center shadow-[inset_0_-1px_var(--line)]'
const FOLD_BUTTON = 'absolute top-[7px] z-10'
const MOVING =
  'motion-safe:[&>[data-panel]]:transition-[flex-grow] motion-safe:[&>[data-panel]]:duration-200 motion-safe:[&>[data-panel]]:ease-[cubic-bezier(.16,1,.3,1)]'

/** A column folded by the panel's own collapse, so the layout saved keeps it too. It opens to the
 * width it had; folded when the page loaded it has none, and opens to `base`. */
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
    onResize: (size: PanelSize) => {
      setFolded(size.inPixels === 0)
      if (size.inPixels > 0 && !moving) setWidth(size.inPixels)
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

/** A column that folds: what is on it keeps its width and is cut as it goes, rather than squeezed,
 * and is out of reach of the keyboard once gone. */
function FoldingColumn({
  id,
  fold,
  size,
  children,
}: {
  id: string
  fold: Fold
  size: { min: number; max: number }
  children: ReactNode
}) {
  return (
    <Panel
      id={id}
      className="flex bg-side"
      defaultSize={`${fold.base}px`}
      minSize={`${size.min}px`}
      maxSize={`${size.max}px`}
      collapsible
      collapsedSize="0px"
      groupResizeBehavior="preserve-pixel-size"
      panelRef={fold.panel}
      onResize={fold.onResize}
    >
      <div className="flex min-w-0 flex-1 overflow-hidden" inert={fold.folded && !fold.moving}>
        <div className="flex flex-1 flex-col" style={{ minWidth: fold.width }}>
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
      className={`relative flex flex-none flex-col overflow-hidden border-r border-line bg-side transition-[width] duration-200 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none ${thin ? 'w-[52px]' : 'w-[196px]'}`}
    >
      <IconButton
        label={t(thin ? 'wb.unfoldRail' : 'wb.foldRail')}
        side="right"
        onClick={toggleRail}
        className={`${FOLD_BUTTON} left-3`}
      >
        {thin ? <ChevronsRight {...ICON} /> : <ChevronsLeft {...ICON} />}
      </IconButton>
      <div className={`${BAR} pl-12 font-semibold tracking-[-0.01em] ${thin ? 'text-transparent' : ''}`}>
        Isbell
      </div>
      <div className="min-h-0 flex-1" />
      <div className="flex-none px-3 pt-1.5 pb-2.5">
        <SettingsMenu onOverlay={onOverlay} />
      </div>
    </nav>
  )
}

function ListHead() {
  const t = useI18n()
  const [shown, setShown] = useState<'sessions' | 'files'>('sessions')
  const tab = (key: typeof shown, label: string) => (
    <button
      type="button"
      onClick={() => setShown(key)}
      aria-pressed={shown === key}
      className={`relative h-full cursor-pointer border-0 bg-transparent p-0 text-[13px] transition-colors duration-75 hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${
        shown === key
          ? "font-semibold text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-text after:content-['']"
          : 'font-medium text-muted'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className={`${BAR} gap-3.5 pr-2 pl-11`}>
      {tab('sessions', t('wb.sessions'))}
      {tab('files', t('wb.files'))}
    </div>
  )
}

export function Frame() {
  const t = useI18n()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
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
              label={t(list.folded ? 'wb.unfoldList' : 'wb.foldList')}
              onClick={list.toggle}
              className={`${FOLD_BUTTON} left-2`}
            >
              {list.folded ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
            </IconButton>
            <IconButton
              label={t(right.folded ? 'wb.unfoldRight' : 'wb.foldRight')}
              onClick={right.toggle}
              className={`${FOLD_BUTTON} right-2`}
            >
              {right.folded ? <PanelRightOpen {...ICON} /> : <PanelRightClose {...ICON} />}
            </IconButton>
            <Group
              orientation="horizontal"
              className={`h-full ${moving ? MOVING : ''}`}
              defaultLayout={split.defaultLayout}
              onLayoutChanged={split.onLayoutChanged}
            >
              <FoldingColumn id="list" fold={list} size={{ min: 208, max: 420 }}>
                <ListHead />
              </FoldingColumn>
              <ResizeHandle label={t('wb.resizeList')} disabled={list.folded} />
              <Panel id="main" className="flex" minSize="480px">
                <main className="flex min-w-0 flex-1 flex-col">
                  <div
                    className={`${BAR} bg-side transition-[padding] duration-200 ${list.folded ? 'pl-11' : ''} ${right.folded ? 'pr-11' : ''}`}
                  />
                  <p className="m-auto text-muted">{t('wb.empty')}</p>
                </main>
              </Panel>
              <ResizeHandle label={t('wb.resizeRight')} disabled={right.folded} />
              <FoldingColumn id="right" fold={right} size={{ min: 264, max: 440 }}>
                <div className={`${BAR} pr-11 pl-3.5 text-[13px] font-semibold`}>{t('wb.active')}</div>
              </FoldingColumn>
            </Group>
          </div>
        </div>
      </div>
      <Overlays overlay={overlay} setOverlay={setOverlay} focusedKey={undefined} />
    </Tooltip.Provider>
  )
}
