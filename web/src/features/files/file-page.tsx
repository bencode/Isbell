// What every file view shares: a bar saying what the file is and when it changed, with the
// view's own tools and the ones every file has (read again, download); the scroll its tab had, for
// the views (which scroll themselves) to go back to; and the notice for a file that is not shown.

import { Download, RotateCw } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'
import { Button } from '../../components/button'
import { IconButton, SMALL_ICON } from '../../components/icon-button'
import { useI18n } from '../../core/i18n'
import { formatSize } from '../../model/files/content'
import type { FileRead } from '../../model/files/remote'
import { since, useNow } from '../../utils/time'

/** Marks a tool that is on. */
export const TOOL_ON = 'aria-pressed:bg-selected aria-pressed:text-text'

/** The file a view shows, and what its bar does. */
export type FileShell = {
  name: string
  /** The directory it is in, relative to the root, for the bar. */
  dir: string
  /** Where it is in full, on pointing at the bar's name of it. */
  where: string
  /** Undefined while it is first read. */
  file: FileRead | undefined
  again: () => void
  download: () => void
  saveError: string | undefined
}

/** What a view of one kind of text file is given. */
export type FileViewProps = {
  shell: FileShell
  text: string
  /** The file, relative to the root. */
  rel: string
  hrefOf: (rel: string) => string
  /** Reads a file under the root (root-relative), for the documents that show more than themselves:
   * a document's images, a page's files. */
  asset: (rel: string) => Promise<Blob>
  /** The file alone in a browser tab of its own. */
  apartHref: string
}

export function FilePage({
  shell,
  tools,
  children,
}: {
  shell: FileShell
  tools?: ReactNode
  children: ReactNode
}) {
  const t = useI18n()
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[34px] flex-none items-center gap-0.5 border-b border-line pr-2 pl-3 text-xs">
        <Crumb shell={shell} />
        <span className="min-w-3 flex-1" />
        {tools}
        <span className="mx-[5px] h-3.5 w-px flex-none bg-line" />
        <IconButton label={t('files.reload')} size="small" onClick={shell.again}>
          <RotateCw {...SMALL_ICON} />
        </IconButton>
        <IconButton label={t('files.download')} size="small" onClick={shell.download}>
          <Download {...SMALL_ICON} />
        </IconButton>
      </header>
      {shell.saveError ? (
        <p className="m-0 px-3 py-1.5 text-[12.5px] text-danger">{shell.saveError}</p>
      ) : null}
      {children}
    </section>
  )
}

/** Its directory, which gives way first and from its start (shrinking so much more that the name
 * loses not a fraction of a pixel until it is gone), then its name; how large and when it changed;
 * on its own, as the clock ticks it. */
function Crumb({ shell: { name, dir, where, file } }: { shell: FileShell }) {
  const now = useNow()
  return (
    <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap" title={where}>
      {dir ? (
        <span dir="rtl" className="min-w-0 shrink-[99999] truncate font-mono text-[11.5px] text-faint">
          <bdi>{dir}</bdi>
        </span>
      ) : null}
      <b className="min-w-0 truncate text-[12.5px] font-semibold">{name}</b>
      {file ? (
        <span className="flex-none font-mono text-[11px] text-faint">
          {formatSize(file.size)}
          {file.mtime === undefined ? '' : ` · ${since(file.mtime, now)}`}
        </span>
      ) : null}
    </span>
  )
}

/** Scroll positions by the scope a tab gives, for this browser tab's life. */
const scrolls = new Map<string, number>()

/** Where the views in it keep their scroll: a tab's. */
export const ScrollScope = createContext<string | null>(null)

/** The scroll of the tab the view is in: where it was when last shown (read each time the view
 * shows, as an Activity shows it again), and where it is now. */
export function useTabScroll() {
  const key = useContext(ScrollScope)
  if (key === null) throw new Error('A ScrollScope is required.')
  return { at: () => scrolls.get(key) ?? 0, onScroll: (top: number) => scrolls.set(key, top) }
}

export function Reading() {
  const t = useI18n()
  return <p className="m-6 text-muted">{t('files.reading')}</p>
}

/** Why a file is not shown, and the way to have it anyway. */
export function Notice({ text, onDownload }: { text: string; onDownload: () => void }) {
  const t = useI18n()
  return (
    <div className="m-6 flex flex-col items-start gap-3">
      <p className="m-0 text-muted">{text}</p>
      <Button onClick={onDownload}>
        <Download size={14} />
        {t('files.download')}
      </Button>
    </div>
  )
}
