// One file read, shown by the view for its kind (an image as one, else text by its kind); or, when
// it is neither or too large to show, what it is and a way to download it. The files a document
// shows beside itself are read for it as it asks.

import { type ComponentType, useMemo, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { assetReader } from '../../model/files/assets'
import { decodeText, type FileKind, formatSize, imageType, kindOf } from '../../model/files/content'
import { join, nameOf } from '../../model/files/paths'
import { type FileRead, PREVIEW_MAX, read } from '../../model/files/remote'
import type { FilesRoot } from '../../model/files/worktrees'
import { pageHref } from '../../utils/hrefs'
import { CodeFile } from './code-file'
import { FilePage, type FileShell, type FileViewProps, Notice, Reading } from './file-page'
import { HtmlFile } from './html-file'
import { ImageFile } from './image-file'
import { MarkdownFile } from './markdown-file'
import { MermaidFile } from './mermaid-file'
import { useFile } from './use-remote'

const VIEWS: Record<FileKind, ComponentType<FileViewProps>> = {
  markdown: MarkdownFile,
  html: HtmlFile,
  mermaid: MermaidFile,
  text: CodeFile,
}

/** `root`: the directory `rel` is under, the project's own or another of its worktrees. */
type Props = {
  mid: string
  root: FilesRoot
  rel: string
  hrefOf: (rel: string) => string
  /** On its own on the screen already: no way to open it apart. */
  alone?: boolean
}

export function Preview(props: Props) {
  const t = useI18n()
  const [round, setRound] = useState(0)
  if (!props.rel) return <p className="m-auto text-muted">{t('files.pick')}</p>
  // A new round reads the file again.
  return <Read key={round} {...props} again={() => setRound(r => r + 1)} />
}

function Read({ mid, root, rel, hrefOf, alone, again }: Props & { again: () => void }) {
  const t = useI18n()
  const { openStream } = useSpace()
  const path = join(root.path, rel)
  const { data, error } = useFile(mid, path)
  const type = imageType(rel)
  const text = useMemo(() => (data?.bytes && !type ? decodeText(data.bytes) : null), [data, type])
  // Afresh for each file and each reading of it: Preview is keyed by the file, Read by the round.
  const asset = useMemo(
    () => assetReader(under => read(openStream, mid, join(root.path, under), PREVIEW_MAX)),
    [openStream, mid, root.path],
  )
  const [saveError, setSaveError] = useState<string>()

  const download = async () => {
    setSaveError(undefined)
    try {
      save(nameOf(rel), await read(openStream, mid, path, Number.POSITIVE_INFINITY))
    } catch (err) {
      setSaveError(errorText(t, err))
    }
  }
  const shell: FileShell = {
    name: nameOf(rel),
    where: `${root.display}/${rel}`,
    file: data,
    again,
    download,
    saveError,
  }
  if (type && data?.bytes) return <ImageFile shell={shell} bytes={data.bytes} type={type} />
  if (text !== null) {
    const View = VIEWS[kindOf(rel)]
    return (
      <View
        shell={shell}
        text={text}
        rel={rel}
        hrefOf={hrefOf}
        asset={asset}
        apartHref={alone ? undefined : pageHref(root.key, rel)}
      />
    )
  }
  return (
    <FilePage shell={shell}>
      {error ? (
        <p className="m-6 text-danger">{errorText(t, error)}</p>
      ) : !data ? (
        <Reading />
      ) : !data.bytes ? (
        <Notice text={t('files.tooLarge', { limit: formatSize(PREVIEW_MAX) })} onDownload={download} />
      ) : (
        <Notice text={t('files.binary')} onDownload={download} />
      )}
    </FilePage>
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
