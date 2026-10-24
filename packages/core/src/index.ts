export { type Connection, type ConnStatus, connect } from './connection'
export { type DirectLink, openDirect, type Path } from './direct'
export { decode, encode, type Frame, FrameError, type Header, type RpcError } from './frame'
export {
  type Caller,
  closePane,
  openShell,
  prompt,
  readScreen,
  type Shell,
  type Started,
  sendKeys,
  shells,
  startAgent,
} from './herdr'
export { authMessage, type Identity, KeyError, originOf, parseKey, signAuth } from './identity'
export {
  type AddJudgement,
  deriveProjects,
  homeOf,
  judgeAdd,
  needs,
  type Project,
  paneKey,
  projectKey,
  type Seen,
  type Session,
} from './projects'
export { createSpace, type MachineEntry, type Space, type SpaceView, type Via } from './space'
export type { Agent, AgentStatus, Caps, MachineInfo, MachineState } from './state'
export {
  CallError,
  type DataFrame,
  type Opened,
  type Stream,
  type StreamEvents,
  WINDOW,
} from './streams'
export {
  openTerminal,
  type Terminal,
  type TerminalEvents,
  type TerminalTarget,
} from './terminal'
