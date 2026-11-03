// What the machine panel in the sidebar says about a machine, in the current language: what it is,
// then, once its gateway has been read, how loaded it is.

import { formatSize } from '../model/files/content'
import type { MachineEntry } from '../model/space'
import type { System } from '../model/system'
import { since } from '../utils/time'
import type { T } from './i18n'

/** Mirrors components/info-panel's InfoGroup, which core cannot import. */
type Fact = { label: string; value: string; mono?: boolean }
type FactGroup = { title: string; rows: Fact[] }

/** The rows a machine has: a fact it does not offer is left out. */
const present = (rows: (Fact | false | null)[]): Fact[] => rows.filter(row => row !== false && row !== null)

export function machineFacts(t: T, { state, online }: MachineEntry, sys: System | undefined): FactGroup[] {
  const { machine, herdr } = state
  const about: FactGroup = {
    title: t('info.machine'),
    rows: present([
      { label: t('facts.name'), value: machine.name },
      { label: t('facts.hostname'), value: machine.hostname, mono: true },
      { label: t('facts.status'), value: online ? t('facts.online') : t('facts.offline') },
      { label: t('facts.os'), value: sys?.os || machine.os },
      !!sys && { label: t('facts.cpu'), value: cpuSpec(t, sys.cpu) },
      // The time from boot (0) to the reading.
      sys?.uptimeSecs != null && { label: t('facts.uptime'), value: since(0, sys.uptimeSecs * 1000) },
      { label: 'isbell', value: machine.version, mono: true },
      { label: 'herdr', value: herdr.version ?? '—', mono: true },
    ]),
  }
  return sys ? [about, usage(t, sys)] : [about]
}

const cpuSpec = (t: T, cpu: System['cpu']) =>
  t('facts.cpuSpec', { brand: cpu.brand || '—', cores: cpu.cores ?? cpu.threads, arch: cpu.arch })

function usage(t: T, { cpu, load, memory, disk }: System): FactGroup {
  const used = (part: number, total: number) =>
    t('facts.used', { used: formatSize(part), total: formatSize(total) })
  return {
    title: t('info.usage'),
    rows: present([
      { label: t('facts.cpu'), value: `${Math.round(cpu.usage)}%` },
      !!load && {
        label: t('facts.load'),
        value: [load.one, load.five, load.fifteen].map(n => n.toFixed(2)).join(' / '),
      },
      { label: t('facts.memory'), value: used(memory.used, memory.total) },
      memory.swapTotal > 0 && { label: t('facts.swap'), value: used(memory.swapUsed, memory.swapTotal) },
      !!disk && {
        label: t('facts.disk'),
        value: t('facts.free', { free: formatSize(disk.free), total: formatSize(disk.total) }),
      },
    ]),
  }
}
