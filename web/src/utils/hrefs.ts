// Where each view lives. Project keys and pane ids contain ':' and '/', so they are encoded.

export const projectHref = (projectKey: string) => `/p/${encodeURIComponent(projectKey)}`

export const terminalHref = (mid: string, paneId: string) => `/t/${mid}/${encodeURIComponent(paneId)}`

/** A pane's files, at `rel` under its project's root (each segment encoded, '/' kept). */
export const filesHref = (mid: string, paneId: string, rel = '') =>
  `/f/${mid}/${encodeURIComponent(paneId)}${rel ? `/${rel.split('/').map(encodeURIComponent).join('/')}` : ''}`
export const sessionHref = (mid: string, paneId: string) => `/s/${mid}/${encodeURIComponent(paneId)}`
