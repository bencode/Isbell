// The worktrees of each project's repository: asked of its machine once, and shared by every view
// that browses the project's files or opens the paths its agents mention; asked again on a refresh.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { worktrees } from '../model/files/remote'
import { type FilesRoot, parseRootKey, rootsOf, type Worktree } from '../model/files/worktrees'
import type { Caller } from '../model/herdr'
import { dirKey, type Project } from '../model/projects'
import { machineOf, projectsSettled } from '../model/space'
import { useProjects, useSpace, useSpaceView } from './space'

const METHOD = 'isbell.git.worktrees'

/** By `dirKey(mid, path)` of the project's directory. */
const known = new Map<string, Worktree[] | 'pending'>()
const listeners = new Set<() => void>()

function settle(id: string, found: Worktree[] | 'pending') {
  known.set(id, found)
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Asks once; asking `again` keeps what was known showing until the answer comes. */
function ask(call: Caller, mid: string, path: string, again = false) {
  const id = dirKey(mid, path)
  if (known.has(id) !== again) return
  if (!again) settle(id, 'pending')
  worktrees(call, mid, path).then(
    found => settle(id, found),
    (err: unknown) => {
      // Kept as none, so the project's own directory still shows; a refresh asks again.
      console.error(`could not list the worktrees of ${path}`, err)
      settle(id, [])
    },
  )
}

/** The roots a project's files are browsed from: its own directory alone until its worktrees are
 * known, and where its machine cannot list them; `settled` once they are known. None for no project. */
export function useFilesRoots(project: Project | undefined): { roots: FilesRoot[]; settled: boolean } {
  const { call } = useSpace()
  const { key = '', mid = '', path = '', display = '', online = false } = project ?? {}
  const machine = machineOf(useSpaceView().machines, mid)
  const able = online && !!path && !!machine?.state.caps.methods.includes(METHOD)
  const id = dirKey(mid, path)
  const found = useSyncExternalStore(subscribe, () => known.get(id))
  useEffect(() => {
    if (able) ask(call, mid, path)
  }, [able, call, mid, path])
  const listed = able && Array.isArray(found) ? found : undefined
  const roots = useMemo(
    () => (key ? rootsOf({ key, path, display }, listed ?? []) : []),
    [key, path, display, listed],
  )
  return { roots, settled: !able || listed !== undefined }
}

/** The project a root key names, its roots, and the root itself; `settled` once neither the
 * project nor the root may yet appear. */
export function useRootOf(key: string) {
  const view = useSpaceView()
  const at = parseRootKey(key)
  const project = useProjects().find(p => p.key === at.project)
  const { roots, settled } = useFilesRoots(project)
  const root = at.branch === undefined ? roots[0] : roots.find(r => r.branch === at.branch)
  return { project, roots, root, settled: projectsSettled(view) && settled }
}

/** Asks for a project's worktrees again, if they were asked for (its machine can list them); the
 * views showing them keep what they have until then. */
export const refreshWorktrees = (call: Caller, project: Project) => ask(call, project.mid, project.path, true)
