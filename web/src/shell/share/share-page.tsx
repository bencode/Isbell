// What someone opening a file share's link sees: the page, run as it runs for whoever shared it,
// its files read live through the share's own space, and little else. It stands apart from the app,
// needs no space of the reader's own, and names neither the machine nor the project.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { HtmlRenderer } from '../../components/renderers/html'
import { useI18n } from '../../core/i18n'
import { RELAY_URL } from '../../core/space'
import { assetReader } from '../../model/files/assets'
import { nameOf } from '../../model/files/paths'
import { PREVIEW_MAX, read } from '../../model/files/remote'
import { parseKey } from '../../model/identity'
import { parseShareHash } from '../../model/share'
import { createSpace, type Space } from '../../model/space'

const REPO = 'https://github.com/bencode/Isbell'

export function SharePage() {
  // Another share's link, pasted over this one, changes only the part after the #.
  useEffect(() => {
    const reload = () => window.location.reload()
    window.addEventListener('hashchange', reload)
    return () => window.removeEventListener('hashchange', reload)
  }, [])
  const t = useI18n()
  const link = parseShareHash(window.location.hash)
  const space = useShareSpace(link?.key)
  const name = link ? nameOf(link.entry) : ''
  useEffect(() => {
    if (name) document.title = name
  }, [name])
  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex h-9 flex-none items-center gap-2.5 border-b border-line px-3.5 text-[13px]">
        <b className="text-[14px] font-bold">Isbell</b>
        <span className="min-w-0 truncate text-muted">{name}</span>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex-none text-[12.5px] text-faint"
        >
          {t('shared.what')}
        </a>
      </header>
      {!link || space === null ? (
        <Notice />
      ) : space ? (
        <Reading space={space} entry={link.entry} />
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

/** The page, while the share's machine is there; it comes back with the machine. */
function Reading({ space, entry }: { space: Space; entry: string }) {
  const view = useSyncExternalStore(space.subscribe, space.getSnapshot)
  const mid = view.machines.find(m => m.online)?.state.machine.id
  const files = useMemo(
    () => (mid ? assetReader(rel => read(space.openStream, mid, rel, PREVIEW_MAX)) : undefined),
    [space, mid],
  )
  if (!view.loaded) return <Notice connecting />
  if (!mid || !files) return <Notice />
  return <HtmlRenderer key={mid} entry={entry} title={nameOf(entry)} read={files} />
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
