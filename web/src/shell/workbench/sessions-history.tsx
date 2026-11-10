// The sessions of a project that ran, under the period they were last active in: what each was first
// asked, and under it what it was last asked. Those hidden are left out, shown faded as asked, and
// found by a search all the same.

import { type ReactNode, useState } from 'react'
import type { To } from 'react-router'
import { useHiddenSessions } from '../../core/hidden-sessions'
import { errorText, type T, useI18n } from '../../core/i18n'
import { toggleHiddenShown, useLocal } from '../../core/prefs'
import { SessionRow } from '../../features/session/session-row'
import { SessionTime } from '../../features/session/session-time'
import { byPeriod, excerpt, lineTime, type Period, type SessionLine, sessionKey } from '../../model/sessions'
import { closedTabId } from '../../model/tabs'

/** A heading of the list, the rows under it. */
export function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-1">
      <h3 className="sticky top-0 z-1 m-0 bg-side px-2 pt-2.5 pb-1 text-[11.5px] font-semibold text-faint">
        {title}
        {count === undefined ? null : <span className="ml-1 font-mono font-medium">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

type Props = {
  mid: string
  /** Those to list, the last active first. */
  history: SessionLine[]
  needle: string
  now: number
  branchOf: (cwd: string) => string | undefined
  row: (id: string) => { shown: boolean; to: To; onKeep: () => void }
}

const NEAR = { today: 'sessions.today', yesterday: 'sessions.yesterday', week: 'sessions.week' } as const

function periodTitle(t: T, p: Period, now: number) {
  if (p.kind !== 'month') return t(NEAR[p.kind])
  const sameYear = p.year === new Date(now).getFullYear()
  return new Date(p.year, p.month).toLocaleDateString(t.locale, {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** What shows under its first ask: what a search found it by, or else what it was last asked. */
function detailOf(s: SessionLine, needle: string) {
  const has = (text: string) => text.toLowerCase().includes(needle)
  if (needle && !has(s.first)) {
    if (s.last && has(s.last)) return { detail: excerpt(s.last, needle), said: true }
    return { detail: excerpt(s.cwd, needle), said: false }
  }
  return s.last && s.last !== s.first ? { detail: s.last, said: true } : { detail: undefined, said: false }
}

export function SessionsHistory({ mid, history, needle, now, branchOf, row }: Props) {
  const t = useI18n()
  const { hidden, able, setHidden } = useHiddenSessions(mid)
  const { hiddenShown } = useLocal().layout
  const [failed, setFailed] = useState<string>()
  const hiddenCount = history.filter(s => hidden.has(sessionKey(s))).length
  const listed = needle || hiddenShown ? history : history.filter(s => !hidden.has(sessionKey(s)))
  const change = (key: string, hide: boolean) => {
    setFailed(undefined)
    setHidden(key, hide).catch((err: unknown) => {
      console.error('could not change the hidden sessions', mid, err)
      setFailed(errorText(t, err))
    })
  }
  return (
    <>
      {byPeriod(listed, lineTime, now).map(({ period, items }) => (
        <Group key={periodTitle(t, period, now)} title={periodTitle(t, period, now)}>
          {items.map(s => {
            const id = closedTabId(mid, s.agent, s.id)
            const key = sessionKey(s)
            const isHidden = hidden.has(key)
            return (
              <SessionRow
                key={id}
                mark={{ agent: s.agent }}
                name={s.first}
                {...detailOf(s, needle)}
                time={<SessionTime at={lineTime(s)} now={now} />}
                hint={[s.first, branchOf(s.cwd)].filter(Boolean).join(' · ')}
                faded={isHidden}
                menuLabel={t('sessions.menu')}
                menu={
                  able
                    ? [
                        {
                          label: t(isHidden ? 'sessions.unhide' : 'sessions.hide'),
                          onClick: () => change(key, !isHidden),
                        },
                      ]
                    : undefined
                }
                needle={needle}
                {...row(id)}
              />
            )
          })}
        </Group>
      ))}
      {failed ? <p className="m-0 px-2 py-1 text-[12.5px] text-danger">{failed}</p> : null}
      {hiddenCount && !needle ? (
        <button
          type="button"
          onClick={toggleHiddenShown}
          className="mx-2 mt-1 cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-text"
        >
          {t(hiddenShown ? 'sessions.hiddenHide' : 'sessions.hiddenShow', { n: hiddenCount })}
        </button>
      ) : null}
    </>
  )
}
