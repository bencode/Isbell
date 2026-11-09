// What someone opening a share link sees: the terminal, live, and little else. It stands apart from
// the app, needs no space of the viewer's own, and names neither the machine nor the project.

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../core/i18n'
import { useWatch } from './use-watch'
import '@xterm/xterm/css/xterm.css'

const REPO = 'https://github.com/bencode/Isbell'
const LIVE_DOT = 'size-[7px] rounded-full bg-danger'

export function WatchPage() {
  const [attempt, setAttempt] = useState(0)
  // Another share's link, pasted over this one, changes only the part after the #.
  useEffect(() => {
    const reload = () => window.location.reload()
    window.addEventListener('hashchange', reload)
    return () => window.removeEventListener('hashchange', reload)
  }, [])
  return (
    <Watching key={attempt} shareKey={window.location.hash.slice(1)} onRetry={() => setAttempt(n => n + 1)} />
  )
}

function Watching({ shareKey, onRetry }: { shareKey: string; onRetry: () => void }) {
  const t = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const { phase, small } = useWatch(box, host, shareKey)
  const showing = phase === 'live' || phase === 'reconnecting'
  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex h-11 flex-none items-center gap-2.5 border-b border-line px-3.5 text-[13px]">
        <b className="text-[15px] font-bold">Isbell</b>
        {phase === 'live' ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-danger">
            <span className={LIVE_DOT} />
            {t('watch.live')}
          </span>
        ) : null}
        {showing ? <span className="text-faint">{t('watch.readOnly')}</span> : null}
        <a href={REPO} target="_blank" rel="noreferrer" className="ml-auto text-[12.5px] text-faint">
          {t('watch.what')}
        </a>
      </header>
      <main className={`relative min-h-0 flex-1 overflow-auto ${showing ? 'bg-term' : ''}`}>
        <div ref={box} className={`relative overflow-hidden ${showing ? '' : 'invisible'}`}>
          <div ref={host} className="absolute top-0 left-0 w-max origin-top-left bg-term p-2" />
          {phase === 'reconnecting' ? (
            <p className="absolute top-1/2 left-1/2 m-0 -translate-1/2 rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-[13px]">
              {t('watch.reconnecting')}
            </p>
          ) : null}
        </div>
        {showing && small ? (
          <p className="m-4 text-center text-[12.5px] text-faint">{t('watch.larger')}</p>
        ) : null}
        {showing ? null : <Notice phase={phase} onRetry={onRetry} />}
      </main>
    </div>
  )
}

function Notice({ phase, onRetry }: { phase: 'connecting' | 'ended' | 'full'; onRetry: () => void }) {
  const t = useI18n()
  const say = {
    connecting: [t('watch.connecting')],
    ended: [t('watch.ended'), t('watch.endedWhy')],
    full: [t('watch.full'), t('watch.fullWhy')],
  }[phase]
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
      <b className="text-[15px] font-semibold">{say[0]}</b>
      {say[1] ? <span className="text-[13px] text-muted">{say[1]}</span> : null}
      {phase === 'full' ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 cursor-pointer rounded-lg border border-line-strong bg-transparent px-3.5 py-1 text-[13px] text-text"
        >
          {t('watch.retry')}
        </button>
      ) : null}
    </div>
  )
}
