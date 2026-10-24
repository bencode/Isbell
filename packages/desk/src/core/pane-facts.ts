// What the info panel beside a session or a terminal says about its pane and how it is reached,
// in the current language.

import type { ConnStatus, DirectStatus, LinkStats, Project, Session, Shell, Via } from '@isbell/core'
import { since } from '../utils/time'
import { errorText, type T } from './i18n'

export type Pane = { session: Session } | { shell: Shell }

export type Found = { project: Project; name: string; pane: Pane }

/** The project a pane belongs to, and what to call it: the agent's name, or the shell's title. */
export const locate = (projects: Project[], mid: string, paneId: string): Found | undefined =>
  projects
    .filter(p => p.mid === mid)
    .flatMap((project): Found[] => {
      const session = project.sessions.find(s => s.paneId === paneId)
      const shell = project.shells.find(s => s.paneId === paneId)
      if (session) return [{ project, name: session.name, pane: { session } }]
      return shell ? [{ project, name: shell.title ?? paneId, pane: { shell } }] : []
    })[0]

/** Mirrors components/info-panel's InfoGroup, which core cannot import. */
type FactGroup = { title: string; rows: { label: string; value: string; mono?: boolean }[] }

/** The session, or the plain terminal, then the machine it runs on. */
export function paneFacts(t: T, now: number, project: Project, pane: Pane): FactGroup[] {
  const own: FactGroup =
    'session' in pane
      ? {
          title: t('info.session'),
          rows: [
            { label: t('facts.agent'), value: pane.session.kind ?? '—' },
            {
              label: t('facts.status'),
              value: t('facts.statusFor', {
                status: t(`status.${pane.session.status}`),
                since: since(pane.session.statusSince, now),
              }),
            },
            { label: t('facts.pane'), value: pane.session.paneId, mono: true },
          ],
        }
      : {
          title: t('info.terminal'),
          rows: [
            { label: t('facts.title'), value: pane.shell.title ?? '—' },
            { label: t('facts.pane'), value: pane.shell.paneId, mono: true },
          ],
        }
  return [
    own,
    {
      title: t('info.machine'),
      rows: [
        { label: t('facts.name'), value: project.machine },
        { label: t('facts.status'), value: project.online ? t('facts.online') : t('facts.offline') },
        { label: t('facts.dir'), value: project.display, mono: true },
      ],
    },
  ]
}

export type Connection = {
  via: Via
  relay: { url: string; status: ConnStatus }
  /** On a direct path: the pair it uses, once read. */
  stats?: LinkStats | undefined
  /** On the relay: where the machine's direct link stands, when the page tries one. */
  direct?: DirectStatus | undefined
}

/** The path a pane's page reaches it by: the direct link's pair, or the relay and why not direct. */
export function connectionFacts(t: T, c: Connection): FactGroup {
  const path = { label: t('conn.path'), value: t(`via.${c.via}`) }
  const { stats, direct } = c
  const rows =
    c.via === 'relay'
      ? [
          path,
          { label: t('conn.relay'), value: `${new URL(c.relay.url).host} · ${t(`conn.${c.relay.status}`)}` },
          ...(direct ? [{ label: t('conn.direct'), value: directText(t, direct) }] : []),
        ]
      : [
          path,
          { label: t('conn.rtt'), value: stats?.rttMs === undefined ? '—' : `${stats.rttMs} ms` },
          { label: t('conn.addresses'), value: stats ? `${stats.local} → ${stats.remote}` : '—', mono: true },
          { label: t('conn.protocol'), value: stats ? stats.protocol.toUpperCase() : '—' },
        ]
  return { title: t('info.connection'), rows }
}

const directText = (t: T, direct: DirectStatus) =>
  direct.state === 'failed'
    ? t('conn.direct.failed', {
        reason: errorText(t, direct.error),
        min: Math.max(1, Math.ceil(direct.retryInMs / 60_000)),
      })
    : t(`conn.direct.${direct.state}`)
