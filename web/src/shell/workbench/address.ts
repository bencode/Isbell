// What an address in a project leads to, where all the workspace shows is tabs. Whatever links to a
// file, in the tree or a document, says where it is: here that opens it in a tab.

import { matchRoutes } from 'react-router'
import { dirOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import { withTab } from '../../model/tabs'
import { projectFilesHref } from '../../utils/hrefs'
import { fileTabId } from './tab-kinds'

type Address = { pathname: string; search: string }

/** What the address says, read as the router reads it: `matchPath` alone leaves it encoded. */
const paramsOf = (path: string, pathname: string) => matchRoutes([{ path }], pathname)?.[0]?.params

/** The root's key an address is under, if any. */
export const rootKeyOf = (pathname: string) => paramsOf('/p/:key/*', pathname)?.key

/** The project an address is in, by its root's key. */
export const projectOf = (pathname: string) => {
  const key = rootKeyOf(pathname)
  return key ? parseRootKey(key).project : undefined
}

/** The root's key and the path under it, on an address of a project's files. */
export const filesOf = (pathname: string) => paramsOf('/p/:key/files/*', pathname)

/** The address to go to instead of this one in a project, if any: a file's, to its tab; one naming no
 * tab, to the tab shown (`useTabRoute`), while any is open. */
export function addressTo({ pathname, search }: Address, active: string | null, shown: string | undefined) {
  const { key, '*': rel } = filesOf(pathname) ?? {}
  if (key && rel && !rel.endsWith('/')) {
    return `${projectFilesHref(key, dirOf(rel))}${withTab('', fileTabId(key, rel))}`
  }
  return active === null && shown ? `${pathname}${withTab(search, shown)}` : undefined
}
