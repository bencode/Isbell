// What a gateway publishes about its machine, as crates/isbell-proto/src/state.rs defines it.

export type MachineInfo = { id: string; name: string; hostname: string; os: string; version: string }

export type HerdrState = {
  status: 'ready' | 'unavailable' | 'incompatible'
  version?: string
  protocol?: number
}

export type Caps = { methods: string[]; agentKinds: string[] }

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

export type Agent = {
  paneId: string
  name?: string
  kind?: string
  status: AgentStatus
  /** Milliseconds on the gateway's clock. */
  statusSince: number
  cwd?: string
  title?: string
}

export type MachineState = {
  machine: MachineInfo
  /** The gateway process: a higher boot means it restarted. */
  boot: number
  rev: number
  herdr: HerdrState
  caps: Caps
  agents: Agent[]
}

export const isNewer = (a: MachineState, b: MachineState): boolean =>
  a.boot > b.boot || (a.boot === b.boot && a.rev > b.rev)

/** A state from the relay, if it has the shape this client reads. */
export function readState(value: unknown): MachineState | undefined {
  const s = value as Partial<MachineState> | null
  const ok =
    typeof s?.machine?.id === 'string' &&
    typeof s.boot === 'number' &&
    typeof s.rev === 'number' &&
    Array.isArray(s.agents) &&
    Array.isArray(s.caps?.agentKinds)
  if (!ok) console.warn('ignoring unreadable machine state', value)
  return ok ? (s as MachineState) : undefined
}
