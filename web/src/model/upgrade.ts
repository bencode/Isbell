// Which machines run an older isbell than this app was built with, and the command that upgrades
// one.

/** The version of isbell this web app was built with: the newest a machine should run. */
export const NEWEST: string = __ISBELL_VERSION__

/** Installs or upgrades isbell; it works on every version, older ones having no `isbell upgrade`. */
export const INSTALL = 'curl -fsSL https://isbell.fmap.dev/install.sh | sh'

const parts = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number)

/** Whether `version` (x.y.z) is older than `latest`; false when either cannot be read. */
export function behind(version: string, latest: string = NEWEST): boolean {
  const have = parts(version)
  const want = parts(latest)
  if (!have || !want) return false
  const differs = have.findIndex((n, i) => n !== want[i])
  return differs >= 0 && (have[differs] ?? 0) < (want[differs] ?? 0)
}

/** What a gateway serves to upgrade its machine from afar. */
export const UPGRADE_METHOD = 'isbell.upgrade'
