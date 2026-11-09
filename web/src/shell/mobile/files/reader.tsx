// A file read on a phone, the whole page being the file and scrolling as one: a document, source, a
// picture; or, for one that cannot be shown, what it is.

import { Check, Ellipsis } from 'lucide-react'
import {
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DropdownMenu, type MenuItem } from '../../../components/menu'
import type { CodeRendererHandle } from '../../../components/renderers/code'
import { HtmlRenderer } from '../../../components/renderers/html'
import { DEFAULT_APPEARANCE } from '../../../components/renderers/markdown/appearance'
import { errorText, useI18n } from '../../../core/i18n'
import { toggleWrapOnPhone, useLocal } from '../../../core/prefs'
import { useFile } from '../../../core/remote-files'
import { useSpace } from '../../../core/space'
import { SourceView } from '../../../features/files/code-file'
import { Reading, ScrollScope, useTabScroll } from '../../../features/files/file-page'
import { useMarkdownParts } from '../../../features/files/markdown-parts'
import { assetReader } from '../../../model/files/assets'
import { decodeText, type FileKind, formatSize, imageType, kindOf } from '../../../model/files/content'
import { dirOf, join, nameOf } from '../../../model/files/paths'
import { PREVIEW_MAX, read } from '../../../model/files/remote'
import type { FilesRoot } from '../../../model/files/worktrees'
import type { Project } from '../../../model/projects'
import { projectFilesHref } from '../../../utils/hrefs'
import { useObjectUrl } from '../../../utils/object-url'
import { BackButton, PhoneBar, TAP } from '../bar'

const MarkdownRenderer = lazy(() =>
  import('../../../components/renderers/markdown').then(m => ({ default: m.MarkdownRenderer })),
)
const MermaidRenderer = lazy(() =>
  import('../../../components/renderers/mermaid').then(m => ({ default: m.MermaidRenderer })),
)

/** What is under the bar, for the views that need a height of their own to scroll or draw in. */
const BELOW_BAR = 'h-[calc(100dvh-52px-env(safe-area-inset-top))]'
const APPEARANCE = { ...DEFAULT_APPEARANCE, fontSize: 16 }
const NO_OUTLINE = { open: false, onOpenChange: () => {}, onState: () => {} }

type Props = { project: Project; root: FilesRoot; rel: string }

export function FileReader(props: Props) {
  const [round, setRound] = useState(0)
  // From the top, not from wherever the page before it was.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  // A new round reads the file again.
  return <Read key={round} {...props} again={() => setRound(r => r + 1)} />
}

function Read({ project, root, rel, again }: Props & { again: () => void }) {
  const t = useI18n()
  const { openStream } = useSpace()
  const { mid } = project
  const { key } = root
  const { wrapOnPhone } = useLocal().layout
  const { data, error } = useFile(mid, join(root.path, rel))
  const type = imageType(rel)
  const text = useMemo(() => (data?.bytes && !type ? decodeText(data.bytes) : null), [data, type])
  const asset = useMemo(
    () => assetReader(under => read(openStream, mid, join(root.path, under), PREVIEW_MAX)),
    [openStream, mid, root.path],
  )
  const hrefOf = useCallback((to: string) => projectFilesHref(key, to), [key])
  const kind = kindOf(rel)
  const name = nameOf(rel)
  const where = [dirOf(rel).replace(/\/$/, ''), root.own ? project.name : root.branch]
    .filter(Boolean)
    .join(' · ')

  const copyPath = () =>
    navigator.clipboard
      .writeText(`${root.display}/${rel}`)
      .catch((err: unknown) => console.error('could not copy the path', err))
  const items: MenuItem[] = [
    { label: t('files.copyPath'), onClick: copyPath },
    { label: t('files.reload'), onClick: again },
    ...(text !== null && kind === 'text'
      ? [
          {
            label: (
              <span className="flex items-center gap-2">
                {t('files.wrap')}
                {wrapOnPhone ? <Check size={15} /> : null}
              </span>
            ),
            onClick: toggleWrapOnPhone,
          },
        ]
      : []),
  ]
  const View = VIEWS[kind]

  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <BackButton />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] leading-tight font-semibold">{name}</b>
          <span className="block truncate text-[11.5px] leading-tight text-faint">{where}</span>
        </div>
        <DropdownMenu
          trigger={
            <button type="button" aria-label={t('mobile.more')} className={TAP}>
              <Ellipsis size={20} />
            </button>
          }
          items={items}
        />
      </PhoneBar>
      <main className="min-w-0 flex-1">
        <ScrollScope value="phone-file">
          {error ? (
            <p className="m-6 text-danger">{errorText(t, error)}</p>
          ) : !data ? (
            <Reading />
          ) : type && data.bytes ? (
            <Picture name={name} bytes={data.bytes} type={type} size={data.size} />
          ) : text !== null ? (
            <View name={name} text={text} rel={rel} hrefOf={hrefOf} asset={asset} wrap={wrapOnPhone} />
          ) : (
            <div className={`${BELOW_BAR} flex flex-col items-center justify-center gap-1 px-6 text-center`}>
              <b className="max-w-full truncate text-[15px] font-medium">{name}</b>
              <span className="font-mono text-[12px] text-faint">{formatSize(data.size)}</span>
              <p className="m-0 mt-2 text-[13.5px] text-muted">{t('mobile.noPreview')}</p>
            </div>
          )}
        </ScrollScope>
      </main>
    </div>
  )
}

type ViewProps = {
  name: string
  text: string
  rel: string
  hrefOf: (rel: string) => string
  asset: (rel: string) => Promise<Blob>
  wrap: boolean
}

function Markdown({ text, rel, hrefOf, asset }: ViewProps) {
  const parts = useMarkdownParts(rel, hrefOf, asset)
  const scroll = useTabScroll()
  return (
    <Suspense fallback={<Reading />}>
      <MarkdownRenderer text={text} appearance={APPEARANCE} outline={NO_OUTLINE} scroll={scroll} {...parts} />
    </Suspense>
  )
}

function Source({ name, text, wrap }: ViewProps) {
  const source = useRef<CodeRendererHandle>(null)
  return <SourceView ref={source} text={text} name={name} wrap={wrap} />
}

function Diagram({ text }: ViewProps) {
  const t = useI18n()
  return (
    <div className={`${BELOW_BAR} flex flex-col`}>
      <Suspense fallback={<Reading />}>
        <MermaidRenderer
          source={text}
          labels={{ drawing: t('files.drawing'), failed: t('files.diagramFailed') }}
        />
      </Suspense>
    </div>
  )
}

function Page({ name, rel, asset }: ViewProps) {
  return (
    <div className={`${BELOW_BAR} flex flex-col`}>
      <HtmlRenderer entry={rel} title={name} read={asset} />
    </div>
  )
}

const VIEWS: Record<FileKind, ComponentType<ViewProps>> = {
  markdown: Markdown,
  html: Page,
  mermaid: Diagram,
  text: Source,
}

function Picture({
  name,
  bytes,
  type,
  size,
}: {
  name: string
  bytes: Uint8Array<ArrayBuffer>
  type: string
  size: number
}) {
  const blob = useMemo(() => new Blob([bytes], { type }), [bytes, type])
  const src = useObjectUrl(blob)
  const [shape, setShape] = useState<string>()
  return (
    <div className="flex min-h-[calc(100dvh-52px-env(safe-area-inset-top))] flex-col justify-center gap-2.5 p-3">
      {src ? (
        <img
          src={src}
          alt={name}
          onLoad={e => setShape(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
          className="block h-auto w-full rounded-lg border border-line bg-raised"
        />
      ) : null}
      <small className="text-center font-mono text-[11.5px] text-faint">
        {[shape, formatSize(size)].filter(Boolean).join(' · ')}
      </small>
    </div>
  )
}
