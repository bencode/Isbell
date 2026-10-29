// Where each view lives. Pane ids contain ':' and '/', so they are encoded; project keys need not be,
// but the branch in a root key is.

export const projectHref = (projectKey: string) => `/p/${projectKey}`

export const terminalHref = (mid: string, paneId: string) => `/t/${mid}/${encodeURIComponent(paneId)}`

/** `rel` as the tail of an address: each segment encoded, '/' kept. */
const tail = (rel: string) => (rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : '')

/** A root key as one segment, its '@' and ':' kept so it reads as written. */
const keyPart = (key: string) => encodeURIComponent(key).replace(/%40|%3A/g, decodeURIComponent)

/** A project's files, at `rel` under the root `key` names (the project's own, or a worktree's). */
export const projectFilesHref = (key: string, rel = '') => `/p/${keyPart(key)}/files${tail(rel)}`

/** The page at `rel` under the root `key` names, on its own in the window. */
export const pageHref = (key: string, rel: string) => `/v/${keyPart(key)}${tail(rel)}`

export const sessionHref = (mid: string, paneId: string) => `/s/${mid}/${encodeURIComponent(paneId)}`

/** The board: one project's, or every agent's. */
export const boardHref = (projectKey?: string) => (projectKey ? projectHref(projectKey) : '/')

/** A session opened beside the board it is on. */
export const peekHref = (projectKey: string | undefined, mid: string, paneId: string) =>
  `${projectKey ? projectHref(projectKey) : ''}${sessionHref(mid, paneId)}`
