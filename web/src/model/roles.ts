// The roles agents took on a machine (`isbell role`, crates/isbell/src/book/roles.rs): a name a
// session takes, kept with the sessions that took it and the role it reports to. Read only here.

import type { Run } from './herdr'
import { type Placed, placedKey } from './projects'

export const rolesPath = '~/.isbell/roles.json'

const VERSION = 1

/** What the page reads of the file; the rest of it is for agents. */
export type Roles = {
  roles: { id: number; name: string; lead?: number }[]
  sessions: { role: number; agent: string; id: string }[]
}

/** A running agent's role, and the name of the role it reports to. */
export type RoleOf = { name: string; lead?: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isRole = (value: unknown) =>
  isObject(value) &&
  typeof value.id === 'number' &&
  typeof value.name === 'string' &&
  (value.lead === undefined || typeof value.lead === 'number')

const isSession = (value: unknown) =>
  isObject(value) &&
  typeof value.role === 'number' &&
  typeof value.agent === 'string' &&
  typeof value.id === 'string'

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

/** The roles `text` holds; undefined when it is no such file. */
export function parseRoles(text: string): Roles | undefined {
  const file = parsed(text)
  const ok =
    isObject(file) &&
    file.version === VERSION &&
    Array.isArray(file.roles) &&
    file.roles.every(isRole) &&
    Array.isArray(file.sessions) &&
    file.sessions.every(isSession)
  return ok ? (file as Roles) : undefined
}

/** The role session `run` took, if it took one. */
export function roleOf(book: Roles, run: Run): RoleOf | undefined {
  const session = book.sessions.find(s => s.agent === run.agent && s.id === run.id)
  const role = session && book.roles.find(r => r.id === session.role)
  if (!role) return undefined
  const lead = role.lead === undefined ? undefined : book.roles.find(r => r.id === role.lead)?.name
  return lead === undefined ? { name: role.name } : { name: role.name, lead }
}

/** Where an agent stands in the right column, the most urgent first. */
export const LANES = ['asking', 'running', 'finished', 'standing'] as const
export type Lane = (typeof LANES)[number]

/** An agent, by its key, on the machine whose book its role is in. */
export type Member = { key: string; machine: string; lane: Lane; role?: RoleOf }

/** Where an agent goes: the lane of its team, its team (by its lead's key), set in under the lead or
 * not, and the agent it reports to in the team. */
export type Placing = { key: string; lane: Lane; team: string; depth: 0 | 1; under?: string }

/** A role is a name in one machine's book, whatever its case. */
export const roleKey = (machine: string, name: string) => `${machine}\n${name.toLowerCase()}`

/** As Jun has them: an agent comes with the running agent it reports to, directly or through others,
 * as a team under the most urgent lane of any in it. The one at the top leads; the others are set in
 * one level. One whose lead runs no agent comes alone. Each machine keeps its own roles, so a team
 * is all on one machine. */
export function teams(members: Member[]): Placing[] {
  // A role runs in one agent at most, so its name finds that agent.
  const running = new Map(
    members.flatMap(m => (m.role ? [[roleKey(m.machine, m.role.name), m] as const] : [])),
  )
  const leadOf = (m: Member) => (m.role?.lead ? running.get(roleKey(m.machine, m.role.lead)) : undefined)
  const topOf = (m: Member) => {
    const seen = new Set([m.key])
    let top = m
    for (let up = leadOf(top); up && !seen.has(up.key); up = leadOf(top)) {
      seen.add(up.key)
      top = up
    }
    return top
  }
  const tops = new Map(members.map(m => [m.key, topOf(m)]))
  const rank = (lane: Lane) => LANES.indexOf(lane)
  const laneOf = new Map<string, Lane>()
  for (const m of members) {
    const team = tops.get(m.key)?.key ?? m.key
    const was = laneOf.get(team)
    if (was === undefined || rank(m.lane) < rank(was)) laneOf.set(team, m.lane)
  }
  return members.map(m => {
    const team = tops.get(m.key)?.key ?? m.key
    const lane = laneOf.get(team) ?? m.lane
    if (team === m.key) return { key: m.key, lane, team, depth: 0 }
    return { key: m.key, lane, team, depth: 1, under: leadOf(m)?.key ?? team }
  })
}

/** `keys`, in their order, with each team brought together where its first one is: its lead, then
 * each one after the one it reports to. */
export function clustered(keys: string[], placings: ReadonlyMap<string, Placing>): string[] {
  const teamOf = (key: string) => placings.get(key)?.team ?? key
  const reports = new Map<string, string[]>()
  for (const key of keys) {
    const under = placings.get(key)?.under
    if (under) reports.set(under, [...(reports.get(under) ?? []), key])
  }
  // Each once, even from a book whose leads go round, which the CLI never writes.
  const placed = new Set<string>()
  const below = (key: string): string[] => {
    if (placed.has(key)) return []
    placed.add(key)
    return [key, ...(reports.get(key) ?? []).flatMap(below)]
  }
  const order = [...new Set(keys.map(teamOf))].flatMap(below)
  return [...order.filter(k => keys.includes(k)), ...keys.filter(k => !placed.has(k))]
}

/** The agents of each lane, in the lanes' order, with the roles they took: what `teams` places. */
export function membersOf(
  byLane: Readonly<Record<Lane, Placed[]>>,
  roleFor: (placed: Placed) => RoleOf | undefined,
): Member[] {
  return LANES.flatMap(lane =>
    byLane[lane].map(p => {
      const role = roleFor(p)
      return { key: placedKey(p), machine: p.session.mid, lane, ...(role ? { role } : {}) }
    }),
  )
}

/** A team as listed: its lead, unless that stays elsewhere for now, and the others in it. */
export type TeamBlock = { team: string; lead?: Placed; members: Placed[] }

/** `list` cut where its teams change. */
export function teamBlocks(list: Placed[], placings: ReadonlyMap<string, Placing>): TeamBlock[] {
  const cut: TeamBlock[] = []
  for (const p of list) {
    const placing = placings.get(placedKey(p))
    const team = placing?.team ?? placedKey(p)
    const last = cut.at(-1)
    const block = last?.team === team ? last : { team, members: [] }
    if (block !== last) cut.push(block)
    if (placing?.depth) block.members.push(p)
    else block.lead = p
  }
  return cut
}

/** The first line a new agent gets from the phone: to name itself, as `name` if given, and to join
 * `lead`'s team if given. */
export const nameYourself = (name?: string, lead?: string) =>
  `Name yourself${name ? ` ${name}` : ''}${lead ? ` and join ${lead}` : ''}, as isbell-tools says.`

/** Work handed to a role from the phone. */
export const newTask = (text: string) =>
  `New task: ${text.trim()}\n\nTake it as isbell-tools says under "Take work from the user".`
