// Where each view lives. Project keys and pane ids contain ':' and '/', so they are encoded.

export const projectHref = (projectKey: string) => `/p/${encodeURIComponent(projectKey)}`

export const terminalHref = (mid: string, paneId: string) => `/t/${mid}/${encodeURIComponent(paneId)}`

export const sessionHref = (mid: string, paneId: string) => `/s/${mid}/${encodeURIComponent(paneId)}`
