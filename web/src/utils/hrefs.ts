// Where each view lives. Pane ids contain ':' and '/', so they are encoded; project keys need not be.

export const projectHref = (projectKey: string) => `/p/${projectKey}`

export const terminalHref = (mid: string, paneId: string) => `/t/${mid}/${encodeURIComponent(paneId)}`

/** `rel` as the tail of an address: each segment encoded, '/' kept. */
const tail = (rel: string) => (rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : '')

/** A project's files, at `rel` under its root. */
export const projectFilesHref = (projectKey: string, rel = '') =>
  `${projectHref(projectKey)}/files${tail(rel)}`

/** The page at `rel` under a project's root, on its own in the window. */
export const pageHref = (projectKey: string, rel: string) => `/v/${projectKey}${tail(rel)}`

export const sessionHref = (mid: string, paneId: string) => `/s/${mid}/${encodeURIComponent(paneId)}`

/** The board: one project's, or every agent's. */
export const boardHref = (projectKey?: string) => (projectKey ? projectHref(projectKey) : '/')

/** A session opened beside the board it is on. */
export const peekHref = (projectKey: string | undefined, mid: string, paneId: string) =>
  `${projectKey ? projectHref(projectKey) : ''}${sessionHref(mid, paneId)}`
