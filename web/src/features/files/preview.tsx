// One file read, shown by the view for its kind; or, when it is not text or too large to show,
// what it is and a way to download it.

import { type ComponentType, useMemo, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { useSpace } from '../../core/space'
import { decodeText, type FileKind, formatSize, kindOf } from '../../model/files/content'
import { join, nameOf } from '../../model/files/paths'
import { type FileRead, PREVIEW_MAX, read } from '../../model/files/remote'
import type { Project } from '../../model/projects'
import { CodeFile } from './code-file'
import { FilePage, type FileShell, type FileViewProps, Notice, Reading } from './file-page'
import { HtmlFile } from './html-file'
import { MarkdownFile } from './markdown-file'
import { useFile } from './use-remote'

const VIEWS: Record<FileKind, ComponentType<FileViewProps>> = {
  markdown: MarkdownFile,
  html: HtmlFile,
  text: CodeFile,
}

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
    where: `${project.display}/${rel}`,
    file: data,
    again,
    download,
    saveError,
  }
  if (text !== null) {
    const View = VIEWS[kindOf(rel)]
    return <View shell={shell} text={text} rel={rel} hrefOf={hrefOf} />
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
