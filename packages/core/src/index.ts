export { type Connection, type ConnStatus, connect } from './connection'
export { type DirectLink, type LinkStats, openDirect } from './direct'
export { decode, encode, type Frame, FrameError, type Header, type RpcError } from './frame'
export {
  type Caller,
  closePane,
  type History,
  openShell,
  prompt,
  readHistory,
  readScreen,
  type Shell,
  type Started,
  sendKeys,
  shells,
  startAgent,
} from './herdr'
export { authMessage, type Identity, KeyError, originOf, parseKey, signAuth } from './identity'
export { type Endpoint, type Path, pathOf } from './path'
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
export {
  type Block,
  type Footer,
  type Live,
  mergeReading,
  parseScreen,
  type Question,
  type Reading,
  type Turn,
} from './screen'
export { stitch } from './screen/history'
export {
  createSpace,
  type DirectStatus,
  type MachineEntry,
  type Space,
  type SpaceView,
  type Via,
} from './space'
export {
  type Agent,
  type AgentStatus,
  type Caps,
  type MachineInfo,
  type MachineState,
  settled,
} from './state'
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
