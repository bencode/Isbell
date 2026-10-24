// What the info panel beside a session or a terminal says about its pane, in the current language.

import type { Project, Session, Shell } from '@isbell/core'
import { since } from '../utils/time'
import type { T } from './i18n'

export type Pane = { session: Session } | { shell: Shell }

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
