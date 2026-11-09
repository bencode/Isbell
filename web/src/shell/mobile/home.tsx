// A phone's first page: every session on the machines online, those that need you first, whichever
// project they are in. The page itself scrolls.

import { ChevronDown, ChevronRight, Plus, Settings2 } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'
import { Link, useNavigationType } from 'react-router'
import { useI18n } from '../../core/i18n'
import { toggleIdle, useLocal } from '../../core/prefs'
import { useProjects, useSpaceView } from '../../core/space'
import { type Overlay, Overlays } from '../../features/settings/settings-dialog'
import { lanes, type Placed, placedKey } from '../../model/projects'
import { useNow } from '../../utils/time'
import { PhoneBar, TAP } from './bar'
import { PhoneCard, PhoneRow } from './card'

// Where the page was left, for coming back to it.
let left = 0

/** Back at the spot it was left; opened anew, at the top. Its sessions are already in memory, so they
 * are there to scroll to at once. */
function useHomeScroll() {
  const how = useNavigationType()
  useLayoutEffect(() => {
    window.scrollTo(0, how === 'POP' ? left : 0)
    const remember = () => {
      left = window.scrollY
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [how])
}

function Lane({ title, placed, now }: { title: string; placed: Placed[]; now: number }) {
  if (!placed.length) return null
  return (
    <section className="flex flex-col gap-2 px-3 pt-3.5">
      <h2 className="m-0 flex items-baseline gap-1.5 px-1 text-[12.5px] font-semibold text-muted">
        {title}
        <span className="font-normal text-faint">{placed.length}</span>
      </h2>
      {placed.map(p => (
        <PhoneCard key={placedKey(p)} placed={p} now={now} />
      ))}
    </section>
  )
}

export function Home() {
  useHomeScroll()
  const t = useI18n()
  const now = useNow()
  const { machines, loaded } = useSpaceView()
  const { asking, finished, running, standing } = lanes(useProjects())
  const { idleOpen } = useLocal().layout
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const none = !asking.length && !finished.length && !running.length && !standing.length
  return (
    <div className="flex min-h-dvh flex-col">
      <PhoneBar>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 pl-2.5">
          <span className="text-[17px] font-bold">Isbell</span>
          <span className="truncate text-[12.5px] text-faint">
            {t('mobile.online', { n: machines.filter(m => m.online).length })}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOverlay('settings')}
          aria-label={t('side.settings')}
          className={TAP}
        >
          <Settings2 size={20} />
        </button>
      </PhoneBar>
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+86px)]">
        <Lane title={t('sessions.asking')} placed={asking} now={now} />
        <Lane title={t('active.finished')} placed={finished} now={now} />
        <Lane title={t('active.running')} placed={running} now={now} />
        {standing.length ? (
          <section className="px-3 pt-2.5">
            <button
              type="button"
              aria-expanded={idleOpen}
              onClick={toggleIdle}
              className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-1 text-left text-[13.5px] text-muted active:bg-hover"
            >
              {idleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {t('active.idleCount', { n: standing.length })}
            </button>
            {idleOpen ? standing.map(p => <PhoneRow key={placedKey(p)} placed={p} now={now} />) : null}
          </section>
        ) : null}
        {loaded && none ? <p className="m-0 px-4 py-4 text-muted">{t('active.none')}</p> : null}
      </main>
      <Link
        to="/new"
        aria-label={t('session.new')}
        className="fixed right-[calc(env(safe-area-inset-right)+16px)] bottom-[calc(env(safe-area-inset-bottom)+16px)] z-10 grid size-[54px] place-items-center rounded-2xl bg-accent text-accent-ink shadow-[0_6px_16px_rgb(12_16_24/0.22)] active:opacity-85"
      >
        <Plus size={24} />
      </Link>
      <Overlays overlay={overlay} setOverlay={setOverlay} />
    </div>
  )
}
