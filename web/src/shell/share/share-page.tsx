// What someone opening a file share's link sees: the file as Files shows it to whoever shared it,
// with the files beside it read live through the share's own space, and little else. It stands
// apart from the app, needs no space of the reader's own, and names neither the machine nor the
// project: to the reader the share's root is `/`.

import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useI18n } from '../../core/i18n'
import { ProvideSpace, RELAY_URL, useSpaceView } from '../../core/space'
import { ScrollScope } from '../../features/files/file-page'
import { Preview } from '../../features/files/preview'
import { nameOf } from '../../model/files/paths'
import type { FilesRoot } from '../../model/files/worktrees'
import { parseKey } from '../../model/identity'
import { parseShareHash, shareUrl } from '../../model/share'
import { createSpace, type Space } from '../../model/space'

const REPO = 'https://github.com/bencode/Isbell'
const ROOT: FilesRoot = { key: '', path: '/', display: '', branch: null, own: true }

export function SharePage() {
  const t = useI18n()
  // A link to another file of the share changes only the part after the #.
  const link = parseShareHash(useLocation().hash)
  const space = useShareSpace(link?.key)
  const name = link ? nameOf(link.entry) : ''
  useEffect(() => {
    if (name) document.title = name
  }, [name])
  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex h-9 flex-none items-center border-b border-line px-3.5 text-[13px]">
        <b className="text-[14px] font-bold">Isbell</b>
        <a href={REPO} target="_blank" rel="noreferrer" className="ml-auto text-[12.5px] text-faint">
          {t('shared.what')}
        </a>
      </header>
      {!link || space === null ? (
        <Notice />
      ) : space ? (
        <ProvideSpace space={space}>
          <Reading shareKey={link.key} entry={link.entry} />
        </ProvideSpace>
      ) : (
        <Notice connecting />
      )}
    </div>
  )
}

/** The share's space: undefined while it is made, null for a key that is not one. */
function useShareSpace(key: string | undefined) {
  const [space, setSpace] = useState<Space | null>()
  useEffect(() => {
    if (!key) return
    let made: Space
    try {
      made = createSpace(RELAY_URL, parseKey(key))
    } catch (err) {
      console.warn('this share link is not valid', err)
      setSpace(null)
      return
    }
    setSpace(made)
    return () => made.close()
  }, [key])
  return key ? space : null
}

/** The file, while the share's machine is there; it comes back with the machine. */
function Reading({ shareKey, entry }: { shareKey: string; entry: string }) {
  const view = useSpaceView()
  const mid = view.machines.find(m => m.online)?.state.machine.id
  const hrefOf = useCallback((rel: string) => shareUrl('', shareKey, rel), [shareKey])
  if (!view.loaded) return <Notice connecting />
  if (!mid) return <Notice />
  return (
    <ScrollScope value={`share:${entry}`}>
      <div className="flex min-h-0 flex-1">
        <Preview mid={mid} root={ROOT} rel={entry} hrefOf={hrefOf} />
      </div>
    </ScrollScope>
  )
}

function Notice({ connecting = false }: { connecting?: boolean }) {
  const t = useI18n()
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
      <b className="text-[15px] font-semibold">{t(connecting ? 'shared.connecting' : 'shared.gone')}</b>
      {connecting ? null : <span className="text-[13px] text-muted">{t('shared.goneWhy')}</span>}
    </main>
  )
}
