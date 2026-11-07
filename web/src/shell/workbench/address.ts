// What an address leads to in the workbench, where there is no page beneath the tabs. Whatever links
// to a file, in the tree, a document or a notification, says where it is: here that opens it in a tab.

import { matchRoutes } from 'react-router'
import { fileTabId } from '../../features/tabs/kinds'
import { dirOf } from '../../model/files/paths'
import { parseRootKey } from '../../model/files/worktrees'
import { withTab } from '../../model/tabs'
import { projectFilesHref } from '../../utils/hrefs'

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

type Known = {
  /** Where the workbench opens; none until that is known. */
  home: string | undefined
  /** The tab the address shows. */
  active: string | null
  /** The tab shown last, if any is open. */
  recent: string | undefined
}

/** The address to go to instead of this one, if any. */
export function addressTo({ pathname, search }: Address, { home, active, recent }: Known) {
  if (pathname === '/') return home
  const { key, '*': rel } = filesOf(pathname) ?? {}
  if (key && rel && !rel.endsWith('/')) {
    return `${projectFilesHref(key, dirOf(rel))}${withTab('', fileTabId(key, rel))}`
  }
  return active === null && recent ? `${pathname}${withTab(search, recent)}` : undefined
}
