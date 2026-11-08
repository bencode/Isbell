// Where each view lives. Project keys need not be encoded, but the branch in a root key is.

export const projectHref = (projectKey: string) => `/p/${projectKey}`

/** `rel` as the tail of an address: each segment encoded, '/' kept. */
const tail = (rel: string) => (rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : '')

/** A root key as one segment, its '@' and ':' kept so it reads as written. */
const keyPart = (key: string) => encodeURIComponent(key).replace(/%40|%3A/g, decodeURIComponent)

/** A project's files, at `rel` under the root `key` names (the project's own, or a worktree's). */
export const projectFilesHref = (key: string, rel = '') => `/p/${keyPart(key)}/files${tail(rel)}`

/** The page at `rel` under the root `key` names, on its own in the window. */
export const pageHref = (key: string, rel: string) => `/v/${keyPart(key)}${tail(rel)}`

/** A session on a phone, at the address its push notifications have. */
export const sessionHref = (mid: string, paneId: string, terminal = false) =>
  `/s/${encodeURIComponent(mid)}${tail(paneId)}${terminal ? '?view=terminal' : ''}`
