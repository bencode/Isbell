// One file read: what it is and when it changed, a view chosen by its kind, and the tools to read
// it again, see its source, or download it. Its scroll is kept for each step of the history, so
// going back lands where it was.

import { Download, RotateCw } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Button } from '../../components/button'
import { errorText, useI18n } from '../../core/i18n'
import { setReader, useLocal } from '../../core/prefs'
import { useSpace } from '../../core/space'
import { decodeText, type FileKind, formatSize, kindOf } from '../../model/files/content'
import { join, nameOf } from '../../model/files/paths'
import { type FileRead, PREVIEW_MAX, read } from '../../model/files/remote'
import type { Project } from '../../model/projects'
import { since, useNow } from '../../utils/time'
import { CodeView } from './code-view'
import { HtmlView } from './html-view'
import { MarkdownView } from './markdown-view'
import { useFile } from './use-remote'

/** Scroll positions by history entry, for this tab's life. */
const scrolls = new Map<string, number>()

type Props = { mid: string; project: Project; rel: string; hrefOf: (rel: string) => string }

export function Preview(props: Props) {
  const t = useI18n()
  const [round, setRound] = useState(0)
  if (!props.rel) return <p className="m-auto text-muted">{t('files.pick')}</p>
  // A new round reads the file again.
  return <Read key={round} {...props} again={() => setRound(r => r + 1)} />
}

function Read({ mid, project, rel, hrefOf, again }: Props & { again: () => void }) {
  const t = useI18n()
  const { openStream } = useSpace()
  const path = join(project.path, rel)
  const { data, error } = useFile(mid, path)
  const text = useMemo(() => (data?.bytes ? decodeText(data.bytes) : null), [data])
  const kind = kindOf(rel)
  const [source, setSource] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  const download = async () => {
    setSaveError(undefined)
    try {
      save(nameOf(rel), await read(openStream, mid, path, Number.POSITIVE_INFINITY))
    } catch (err) {
      setSaveError(errorText(t, err))
    }
  }
  const body = () => {
    if (error) return <p className="m-6 text-danger">{errorText(t, error)}</p>
    if (!data) return <p className="m-6 text-muted">{t('files.reading')}</p>
    if (!data.bytes)
      return <Notice text={t('files.tooLarge', { limit: formatSize(PREVIEW_MAX) })} onDownload={download} />
    if (text === null) return <Notice text={t('files.binary')} onDownload={download} />
    if (kind === 'html' && !source) return <HtmlView html={text} />
    return (
      <Scroller>
        {scroller =>
          kind === 'markdown' && !source ? (
            <MarkdownView text={text} rel={rel} hrefOf={hrefOf} scroller={scroller} />
          ) : (
            <CodeView text={text} name={nameOf(rel)} />
          )
        }
      </Scroller>
    )
  }
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-[48px] flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2">
        <b className="truncate">{nameOf(rel)}</b>
        <Facts where={`${project.display}/${rel}`} file={data} />
        <span className="flex-1" />
        {/* Markdown and HTML have a view besides their source; text has only its source. */}
        {text !== null && kind !== 'text' ? (
          <ViewTools kind={kind} source={source} onSource={setSource} />
        ) : null}
        <Button
          size="icon"
          variant="quiet"
          onClick={again}
          aria-label={t('files.reload')}
          title={t('files.reload')}
        >
          <RotateCw size={14} />
        </Button>
        <Button
          size="icon"
          variant="quiet"
          onClick={download}
          aria-label={t('files.download')}
          title={t('files.download')}
        >
          <Download size={14} />
        </Button>
      </header>
      {saveError ? <p className="m-0 px-5 py-1.5 text-[12.5px] text-danger">{saveError}</p> : null}
      {body()}
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

/** Aa steps through the text sizes. */
const NEXT_SIZE = { s: 'm', m: 'l', l: 's' } as const

function ViewTools({
  kind,
  source,
  onSource,
}: {
  kind: FileKind
  source: boolean
  onSource: (source: boolean) => void
}) {
  const t = useI18n()
  const reader = useLocal().layout.reader
  return (
    <>
      <Toggle
        options={[
          {
            on: !source,
            label: kind === 'html' ? t('files.preview') : t('files.rendered'),
            pick: () => onSource(false),
          },
          { on: source, label: t('files.source'), pick: () => onSource(true) },
        ]}
      />
      {kind === 'markdown' && !source ? (
        <>
          <Button
            size="small"
            variant="quiet"
            title={t('files.textSize')}
            onClick={() => setReader({ size: NEXT_SIZE[reader.size] })}
          >
            Aa
          </Button>
          <Toggle
            options={[
              { on: reader.wide, label: t('files.wide'), pick: () => setReader({ wide: !reader.wide }) },
            ]}
          />
        </>
      ) : null}
    </>
  )
}

/** The scrolling body, back at the scroll it had when this history entry was last shown. */
function Scroller({ children }: { children: (scroller: HTMLElement | null) => ReactNode }) {
  const { key } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const [el, setEl] = useState<HTMLElement | null>(null)
  // The content renders in the same commit, so its height is there to scroll to.
  useLayoutEffect(() => {
    setEl(ref.current)
    if (ref.current) ref.current.scrollTop = scrolls.get(key) ?? 0
  }, [key])
  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-auto"
      onScroll={e => scrolls.set(key, e.currentTarget.scrollTop)}
    >
      {children(el)}
    </div>
  )
}

function Notice({ text, onDownload }: { text: string; onDownload: () => void }) {
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

function Toggle({ options }: { options: { on: boolean; label: string; pick: () => void }[] }) {
  return (
    <span className="inline-flex flex-none gap-0.5 rounded-lg border border-line bg-bg p-0.5">
      {options.map(o => (
        <button
          key={o.label}
          type="button"
          aria-pressed={o.on}
          onClick={o.pick}
          className={`h-[26px] cursor-pointer rounded-md border-0 px-2.5 text-[12.5px] ${o.on ? 'bg-raised text-text' : 'bg-transparent text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

function save(name: string, file: FileRead) {
  const url = URL.createObjectURL(new Blob([file.bytes ?? new Uint8Array()]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // After the click has handed the file to the browser.
  setTimeout(() => URL.revokeObjectURL(url))
}
