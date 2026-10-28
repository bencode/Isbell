// What every file view shares: a header saying what the file is and when it changed, with the
// view's own tools and the ones every file has (read again, download); the scroll each step of the
// history had, for the views (which scroll themselves) to go back to; and the notice for a file that
// is not shown.

import { Download, RotateCw } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'
import { useLocation } from 'react-router'
import { Button } from '../../components/button'
import { useI18n } from '../../core/i18n'
import { formatSize } from '../../model/files/content'
import type { FileRead } from '../../model/files/remote'
import { since, useNow } from '../../utils/time'

/** The file a view shows, and what its header does. */
export type FileShell = {
  name: string
  /** Where it is, for the header. */
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
  /** The file alone in a tab of its own. */
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
      <header className="flex min-h-[48px] flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2">
        <b className="truncate">{shell.name}</b>
        <Facts where={shell.where} file={shell.file} />
        <span className="flex-1" />
        {tools}
        <Button
          size="icon"
          variant="quiet"
          onClick={shell.again}
          aria-label={t('files.reload')}
          title={t('files.reload')}
        >
          <RotateCw size={14} />
        </Button>
        <Button
          size="icon"
          variant="quiet"
          onClick={shell.download}
          aria-label={t('files.download')}
          title={t('files.download')}
        >
          <Download size={14} />
        </Button>
      </header>
      {shell.saveError ? (
        <p className="m-0 px-5 py-1.5 text-[12.5px] text-danger">{shell.saveError}</p>
      ) : null}
      {children}
    </section>
  )
}

/** Where the file is, how large, and when it changed; on its own, as the clock ticks it. */
function Facts({ where, file }: { where: string; file: FileRead | undefined }) {
  const now = useNow()
  return (
    <span className="min-w-0 truncate font-mono text-[11.5px] text-faint">
      {where}
      {file ? ` · ${formatSize(file.size)}` : ''}
      {file?.mtime === undefined ? '' : ` · ${since(file.mtime, now)}`}
    </span>
  )
}

/** Scroll positions by history entry, or by the scope a file tab gives, for this tab's life. */
const scrolls = new Map<string, number>()

/** Where the views in it keep their scroll instead of by history entry: a file tab, which shows
 * over whatever entry is current. */
export const ScrollScope = createContext<string | null>(null)

/** This history entry's scroll: where it was when last shown (read each time the view shows, as an
 * Activity shows it again), and where it is now. Remount the view by `key`, so it starts at `at()`
 * again for a new entry. */
export function useHistoryScroll() {
  const { key: entry } = useLocation()
  const key = useContext(ScrollScope) ?? entry
  return { key, at: () => scrolls.get(key) ?? 0, onScroll: (top: number) => scrolls.set(key, top) }
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
