// The directories a project's files are browsed in: its own, and the other worktrees of its
// repository that have a branch checked out, each addressed by a key of its own.

import { homeOf, type Project, tildify } from '../projects'
import { relative } from './paths'

/** A worktree as the machine's gateway reports it; `here` is the directory asked about. */
export type Worktree = { path: string; branch: string | null; here: boolean }

/** A directory whose files are browsed. `key` addresses it in hrefs, tab ids and the folders kept
 * open: the project's own key for its own directory, `<key>@<branch>` for another worktree. */
export type FilesRoot = { key: string; path: string; display: string; branch: string | null; own: boolean }

// Git allows no ':' in a branch name, so it stands in for the '/' an address cannot hold.
export const rootKey = (projectKey: string, branch: string) => `${projectKey}@${branch.replaceAll('/', ':')}`

/** The project and the branch a root key names; a project key holds no '@'. */
export function parseRootKey(key: string): { project: string; branch?: string } {
  const at = key.indexOf('@')
  return at < 0
    ? { project: key }
    : { project: key.slice(0, at), branch: key.slice(at + 1).replaceAll(':', '/') }
}

/** The project's own directory first, then the other worktrees with a branch, by branch. */
export function rootsOf(
  project: Pick<Project, 'key' | 'path' | 'display'>,
  worktrees: Worktree[],
): FilesRoot[] {
  const own: FilesRoot = {
    key: project.key,
    path: project.path,
    display: project.display,
    branch: worktrees.find(w => w.here)?.branch ?? null,
    own: true,
  }
  const others = worktrees
    .flatMap(({ path, branch, here }) =>
      here || branch === null
        ? []
        : [
            {
              key: rootKey(project.key, branch),
              path,
              display: tildify(path, homeOf([path, project.path])),
              branch,
              own: false,
            },
          ],
    )
    .sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0))
  return [own, ...others]
}

/** The root `abs` is under, the deepest where worktrees nest, and where it sits in it; `at` is the
 * side of a root compared (its path, or its path as shown). */
export function rootHolding(roots: FilesRoot[], abs: string, at: (root: FilesRoot) => string = r => r.path) {
  return roots
    .flatMap(root => {
      const rel = relative(at(root), abs)
      return rel === undefined ? [] : [{ root, rel }]
    })
    .reduce<{ root: FilesRoot; rel: string } | undefined>(
      (deepest, found) => (deepest && deepest.rel.length <= found.rel.length ? deepest : found),
      undefined,
    )
}
