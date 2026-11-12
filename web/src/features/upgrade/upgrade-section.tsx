// The part of a machine's panel about its isbell, while that is older than this page: one press where
// its gateway can upgrade itself, else the command to run there.

import { Check, RotateCw } from 'lucide-react'
import { Button } from '../../components/button'
import { Command } from '../../components/command'
import { type Key, useI18n } from '../../core/i18n'
import type { MachineEntry } from '../../model/space'
import { behind, INSTALL, NEWEST, UPGRADE_METHOD } from '../../model/upgrade'
import type { Upgrade } from './use-upgrade'

const WHY: Record<Extract<Upgrade, { phase: 'failed' }>['why'], Key> = {
  failed: 'upgrade.failed',
  notRestarted: 'upgrade.notRestarted',
  timeout: 'upgrade.timeout',
}
const LOG =
  'm-0 max-h-40 overflow-auto rounded-md bg-bg p-2 font-mono text-[11.5px] break-all whitespace-pre-wrap text-muted'

/** Whether the machine's panel has this to say. */
export const flagged = (entry: MachineEntry, upgrade: Upgrade) =>
  upgrade.phase !== 'idle' || (entry.online && behind(entry.state.machine.version))

export function UpgradeSection({
  entry,
  upgrade,
  start,
}: {
  entry: MachineEntry
  upgrade: Upgrade
  start: () => void
}) {
  const t = useI18n()
  const { version } = entry.state.machine
  const able = entry.state.caps.methods.includes(UPGRADE_METHOD)
  const labels = { copy: t('copy'), copied: t('copied') }
  const manual = (
    <>
      <p className="m-0 text-muted">{t(able ? 'upgrade.manualAfter' : 'upgrade.manual')}</p>
      <Command text={INSTALL} labels={labels} />
    </>
  )
  const body = () => {
    if (upgrade.phase === 'upgrading')
      return (
        <p className="m-0 flex items-center gap-2 text-muted">
          <RotateCw size={13} className="flex-none animate-spin" />
          {t('upgrade.running')}
        </p>
      )
    if (upgrade.phase === 'done')
      return (
        <p className="m-0 flex items-start gap-2">
          <Check size={14} className="mt-0.5 flex-none text-ok" />
          <span>
            {t('upgrade.done', { version: upgrade.version })}
            {behind(upgrade.version) ? ` ${t('upgrade.latest')}` : ''}
          </span>
        </p>
      )
    if (upgrade.phase === 'failed')
      return (
        <>
          <p className="m-0 text-danger">{t(WHY[upgrade.why])}</p>
          {upgrade.log ? <pre className={LOG}>{upgrade.log}</pre> : null}
          {manual}
        </>
      )
    if (!able) return manual
    return (
      <div className="flex items-center gap-3">
        <Button variant="primary" size="small" className="flex-none" onClick={start}>
          {t('upgrade.run')}
        </Button>
        <span className="text-xs text-muted">{t('upgrade.offline')}</span>
      </div>
    )
  }
  return (
    <section className="flex flex-col gap-2.5 border-b border-line pb-4">
      <p className="m-0 font-semibold">{t('upgrade.from', { from: version, to: NEWEST })}</p>
      {body()}
    </section>
  )
}
