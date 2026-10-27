// Where each view lives. Project keys and pane ids contain ':' and '/', so they are encoded.

export const projectHref = (projectKey: string) => `/p/${encodeURIComponent(projectKey)}`

export const terminalHref = (mid: string, paneId: string) => `/t/${mid}/${encodeURIComponent(paneId)}`

/** `rel` as the tail of an address: each segment encoded, '/' kept. */
const tail = (rel: string) => (rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : '')

/** A pane's files, at `rel` under its project's root. */
export const filesHref = (mid: string, paneId: string, rel = '') =>
  `/f/${mid}/${encodeURIComponent(paneId)}${tail(rel)}`

/** A project's files, at `rel` under its root. */
export const projectFilesHref = (projectKey: string, rel = '') =>
  `${projectHref(projectKey)}/files${tail(rel)}`

/** The page at `rel` under a project's root, on its own in the window. */
export const pageHref = (projectKey: string, rel: string) =>
  `/v/${encodeURIComponent(projectKey)}${tail(rel)}`

export const sessionHref = (mid: string, paneId: string) => `/s/${mid}/${encodeURIComponent(paneId)}`
