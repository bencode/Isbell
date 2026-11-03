// What a machine is and how loaded it is, as its gateway's `isbell.system` reads it
// (crates/isbell/src/gateway/system.rs). Facts a platform does not offer are null.

import type { Caller } from './herdr'

export const SYSTEM_METHOD = 'isbell.system'

/** Byte counts throughout; CPU usage is percent of all CPUs since the gateway's last read, or over a
 * moment of its own when that was a while ago. */
export type System = {
  os: string | null
  uptimeSecs: number | null
  cpu: { brand: string; cores: number | null; threads: number; arch: string; usage: number }
  load: { one: number; five: number; fifteen: number } | null
  memory: { total: number; used: number; swapTotal: number; swapUsed: number }
  /** The disk holding the home directory. */
  disk: { mount: string; total: number; free: number } | null
}

/** A read after a pause waits a moment for a second CPU sample. */
const CALL_TIMEOUT_MS = 10_000

export const readSystem = async (call: Caller, mid: string) =>
  (await call(mid, SYSTEM_METHOD, {}, CALL_TIMEOUT_MS)) as System
