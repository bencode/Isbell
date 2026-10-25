// What the info panel beside a session or a terminal says about its pane and how it is reached,
// in the current language.

import type { ConnStatus } from '../model/connection'
import type { LinkStats } from '../model/direct'
import type { Endpoint } from '../model/path'
import type { Pane, Project } from '../model/projects'
import type { DirectStatus, Via } from '../model/space'
import { shellArg } from '../utils/shell'
import { since } from '../utils/time'
import { errorText, type T } from './i18n'

/** How to reach a pane by hand: an agent by its name, as the session page shows it; a shell by its pane. */
export const attachCommand = (project: Project, pane: Pane) =>
  `isbell terminal attach --control ${shellArg(
    `${project.machine}/${'session' in pane ? pane.session.name : pane.shell.paneId}`,
  )}`

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
          { label: t('conn.machineEnd'), value: stats ? endText(t, stats.remote) : '—' },
          { label: t('conn.browserEnd'), value: stats ? endText(t, stats.local, t('conn.end.hidden')) : '—' },
          { label: t('conn.protocol'), value: stats ? stats.protocol.toUpperCase() : '—' },
        ]
  return { title: t('info.connection'), rows }
}

/** An end of the pair: its address, or `hidden` where there is none (an mDNS name only stands in
 * for one), then what kind of address that is. */
const endText = (t: T, end: Endpoint, hidden?: string) => {
  const key = `conn.end.${end.type}`
  const kind = t.has(key) ? t(key) : end.type
  const shown = end.address && !end.address.endsWith('.local') ? end.address : hidden
  return shown ? `${shown} · ${kind}` : kind
}

const directText = (t: T, direct: DirectStatus) =>
  direct.state === 'failed'
    ? t('conn.direct.failed', {
        reason: errorText(t, direct.error),
        min: Math.max(1, Math.ceil(direct.retryInMs / 60_000)),
      })
    : t(`conn.direct.${direct.state}`)
