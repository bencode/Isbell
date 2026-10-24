// Joining a space: paste the key, or open a link carrying it as #k=…

import { KeyError, parseKey } from '@isbell/core'
import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/button'
import { type Key, useI18n } from '../../core/i18n'
import { updateLocal } from '../../core/prefs'

/** Takes a key from a `#k=` link and clears it from the address bar and history at once. */
export function takeKeyFromLink(): string | null {
  const match = /^#k=(.+)$/.exec(window.location.hash)
  if (!match?.[1]) return null
  history.replaceState(history.state, '', window.location.pathname + window.location.search)
  return decodeURIComponent(match[1])
}

const REASON: Record<KeyError['reason'], Key> = {
  prefix: 'join.prefix',
  encoding: 'join.encoding',
  checksum: 'join.checksum',
}

export function Join({
  rejected,
  initial,
  onJoined,
}: {
  rejected: boolean
  initial: string | null
  onJoined: () => void
}) {
  const t = useI18n()
  const [key, setKey] = useState(initial ?? '')
  const [problem, setProblem] = useState<Key | null>(rejected ? 'join.rejected' : null)

  const join = () => {
    try {
      const id = parseKey(key)
      updateLocal(() => ({ key: id.key }))
      onJoined()
    } catch (err) {
      if (!(err instanceof KeyError)) throw err
      setProblem(REASON[err.reason])
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="flex w-[min(480px,100%)] flex-col gap-4 rounded-xl border border-line bg-raised p-6"
        onSubmit={e => {
          e.preventDefault()
          join()
        }}
      >
        <span className="flex items-center gap-2 font-bold">
          <SquareTerminal size={20} className="text-accent" aria-hidden="true" />
          Isbell
        </span>
        <h1 className="m-0 text-xl font-semibold">{t('join.title')}</h1>
        <p className="m-0 text-muted">{t('join.body')}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('join.key')}</span>
          <input
            // biome-ignore lint/a11y/noAutofocus: joining is the only thing to do here.
            autoFocus
            type="password"
            name="password"
            autoComplete="current-password"
            value={key}
            onChange={e => {
              setKey(e.target.value)
              setProblem(null)
            }}
            placeholder="isbk1-…"
            spellCheck={false}
            className="h-[38px] rounded-lg border border-line bg-bg px-3 font-mono text-[13px] text-text outline-none focus:outline-2 focus:outline-accent"
          />
        </label>
        {problem ? (
          <p className="m-0 text-danger">{t(problem)}</p>
        ) : (
          <p className="m-0 text-[13px] text-muted">{t('join.save')}</p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!key.trim()}>
            {t('join.go')}
          </Button>
        </div>
      </form>
    </div>
  )
}
