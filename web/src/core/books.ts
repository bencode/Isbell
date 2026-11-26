// The books agents keep on each machine (`isbell role`, `goal`, `task` and `message`),
// read by one pull for every view: each machine's file every 15 seconds while the page shows, sent
// only when it changed. Read only: agents write them.

import { useEffect, useSyncExternalStore } from 'react'
import { type FileRead, read } from '../model/files/remote'
import { type Goals, goalsPath, parseGoals } from '../model/goals'
import { feed, type Message, type Messages, messagesPath, parseMessages } from '../model/messages'
import { lanes, type Placed } from '../model/projects'
import { parseRoles, type RoleOf, type Roles, roleKey, roleOf, rolesPath } from '../model/roles'
import type { Space } from '../model/space'
import { CallError } from '../model/streams'
import { useProjects, useSpace, useSpaceView } from './space'

const EVERY_MS = 15_000
/** Far above what 500 messages with their replies take. */
const BOOK_MAX = 4 << 20
const READ_METHOD = 'isbell.file.read'

const KINDS = {
  roles: { path: rolesPath, parse: parseRoles },
  goals: { path: goalsPath, parse: parseGoals },
  messages: { path: messagesPath, parse: parseMessages },
}
type Kind = keyof typeof KINDS

/** A machine's books; one it has none of is left out, as on a machine whose isbell predates it. */
export type Books = { roles?: Roles; goals?: Goals; messages?: Messages }

let books: Readonly<Record<string, Books>> = {}
// The last read of each file, by machine id and kind, to read against.
const reads = new Map<string, FileRead>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function settle(mid: string, kind: Kind, book: Books[Kind] | undefined) {
  const { [kind]: _, ...rest } = books[mid] ?? {}
  books = { ...books, [mid]: book === undefined ? rest : { ...rest, [kind]: book } }
  for (const listener of listeners) listener()
}

/** Reads one file again; a file as it was is left as it was, and one that cannot be read keeps the
 * last one read. */
async function pull(open: Space['openStream'], mid: string, kind: Kind) {
  const at = `${mid}\n${kind}`
  const { path, parse } = KINDS[kind]
  try {
    const previous = reads.get(at)
    const found = await read(open, mid, path, BOOK_MAX, {}, previous)
    if (found === previous) return
    reads.set(at, found)
    const book = found.bytes ? parse(new TextDecoder().decode(found.bytes)) : undefined
    if (book) settle(mid, kind, book)
    else console.warn('cannot read', path, 'of', mid)
  } catch (err) {
    if (err instanceof CallError && err.code === 'not_found') {
      reads.delete(at)
      if (books[mid]?.[kind]) settle(mid, kind, undefined)
    } else console.warn('could not read', path, 'of', mid, err)
  }
}

/** The machines whose books can be read now. */
const readable = (space: Space) =>
  space
    .getSnapshot()
    .machines.filter(m => m.online && m.state.caps.methods.includes(READ_METHOD))
    .map(m => m.state.machine.id)

/** Keeps the books of every machine online read while the page shows; mounted once. A machine that
 * comes online is read at once, rather than at the next turn. */
export function useBooksPull() {
  const space = useSpace()
  useEffect(() => {
    let live = true
    let pulling = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // The machines read since they came online.
    let known = new Set<string>()
    const tick = async () => {
      pulling = true
      const mids = readable(space)
      known = new Set(mids)
      const kinds = Object.keys(KINDS) as Kind[]
      // A machine's books one after another: each read is a stream, and a gateway takes only a few
      // at once from the page, which the views coming up need too.
      await Promise.all(
        mids.map(async mid => {
          for (const kind of kinds) await pull(space.openStream, mid, kind)
        }),
      )
      pulling = false
      if (live) timer = setTimeout(next, EVERY_MS)
    }
    const next = () => {
      if (document.visibilityState === 'visible') void tick()
      else timer = setTimeout(next, EVERY_MS)
    }
    const wake = () => {
      if (pulling || document.visibilityState !== 'visible') return
      clearTimeout(timer)
      void tick()
    }
    const unsubscribe = space.subscribe(() => {
      const mids = readable(space)
      known = new Set(mids.filter(mid => known.has(mid)))
      if (mids.some(mid => !known.has(mid))) wake()
    })
    document.addEventListener('visibilitychange', wake)
    next()
    return () => {
      live = false
      clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [space])
}

/** Every machine's books, by machine id. */
export const useBooks = (): Readonly<Record<string, Books>> => useSyncExternalStore(subscribe, () => books)

/** The role an agent took, by its machine's book and the session it runs. */
export function useRoleOf(): (placed: Placed) => RoleOf | undefined {
  const books = useBooks()
  const { runs } = useSpaceView()
  return ({ session }) => {
    const run = runs[session.mid]?.[session.paneId]
    const book = books[session.mid]?.roles
    return run && book ? roleOf(book, run) : undefined
  }
}

/** A machine online with goals, by its id and name. */
export type Shelf = { mid: string; name: string; book: Goals }

/** The machines online with goals, in their order. */
export function useGoalShelves(): Shelf[] {
  const books = useBooks()
  return useSpaceView()
    .machines.filter(m => m.online)
    .flatMap(({ state: { machine } }) => {
      const book = books[machine.id]?.goals
      return book ? [{ mid: machine.id, name: machine.name, book }] : []
    })
}

/** The agents running a role, by `roleKey` of their machine and the role's name. */
export function useRunningRoles(): ReadonlyMap<string, Placed> {
  const live = lanes(useProjects())
  const roleFor = useRoleOf()
  return new Map(
    [...live.asking, ...live.running, ...live.finished, ...live.standing].flatMap(p => {
      const role = roleFor(p)
      return role ? [[roleKey(p.session.mid, role.name), p] as const] : []
    }),
  )
}

/** A message, with the machine it is on. */
export type Posted = { mid: string; name: string; message: Message }

/** The messages of the machines online, as one list: the latest active first. */
export function useMessageFeed(): Posted[] {
  const books = useBooks()
  return feed(
    useSpaceView()
      .machines.filter(m => m.online)
      .flatMap(({ state: { machine } }) =>
        (books[machine.id]?.messages?.messages ?? []).map(message => ({
          mid: machine.id,
          name: machine.name,
          message,
        })),
      ),
  )
}

/** Finds the agent running a session, by its machine, agent and id. */
export function useRunningSession(): (mid: string, agent: string, id: string) => Placed | undefined {
  const live = lanes(useProjects())
  const { runs } = useSpaceView()
  return (mid, agent, id) =>
    [...live.asking, ...live.running, ...live.finished, ...live.standing].find(({ session }) => {
      const run = session.mid === mid ? runs[mid]?.[session.paneId] : undefined
      return run?.agent === agent && run.id === id
    })
}
