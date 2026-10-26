// A direct link to one machine: a WebRTC DataChannel set up through the relay with the gateway's
// `isbell.rtc.offer`. Frames on it are the relay's frames without routing fields, one per message,
// or in pieces when too long for one and the gateway agreed to pieces.

import { encode } from './frame'
import type { Caller } from './herdr'
import { type Endpoint, type Path, pathOf } from './path'
import { createAssembler, split } from './pieces'
import { CallError, createRouter, type Opened, type StreamEvents } from './streams'

// DirectLink names the path it took, so its type travels with it.
export type { Path }

/** The candidate pair ICE chose, as the browser last measured it. */
export type LinkStats = {
  /** Round trip in milliseconds, once ICE has measured one. */
  rttMs: number | undefined
  /** This browser's end; browsers usually keep its address to themselves. */
  local: Endpoint
  /** The machine's end. */
  remote: Endpoint
  /** 'udp' or 'tcp'. */
  protocol: string
}

export type DirectLink = {
  path: Path
  /** The gateway takes and sends long frames in pieces, so answers of any size can come this way. */
  pieces: boolean
  open: (m: string, p: unknown, timeoutMs: number, events: StreamEvents) => Promise<Opened>
  call: (m: string, p: unknown, timeoutMs: number) => Promise<unknown>
  /** Undefined once no pair is chosen, as when the link is going. */
  stats: () => Promise<LinkStats | undefined>
  close: () => void
  /** Settles once the link is gone, whichever side ended it. */
  closed: Promise<void>
}

/** The gateway's default STUN servers, so both sides look for their public addresses alike. */
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
/** The offer goes out once gathering completes, SETTLE_MS after the first public address, or
 * after this, as the gateway does. */
const GATHER_MS = 2_500
/** STUN servers answer within a few hundred milliseconds of each other, so waiting this long after
 * the first public address brings the other family's too. */
const SETTLE_MS = 500
/** Offer, answer and the channel opening together, as the CLI allows. */
const DIRECT_MS = 10_000

type Description = { type: RTCSdpType; sdp: string }

export async function openDirect(call: Caller, mid: string): Promise<DirectLink> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] })
  const channel = pc.createDataChannel('isbell')
  channel.binaryType = 'arraybuffer'
  try {
    const pieces = await connect(pc, channel, call, mid, Date.now() + DIRECT_MS)
    return carry(pc, channel, await pathOfLink(pc), pieces)
  } catch (err) {
    pc.close()
    throw new CallError('direct_failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Whether the gateway agreed to pieces. Every step is bounded, so this settles by `deadline` (plus
 * at most the gathering).
 */
async function connect(
  pc: RTCPeerConnection,
  channel: RTCDataChannel,
  call: Caller,
  mid: string,
  deadline: number,
): Promise<boolean> {
  const left = () => Math.max(0, deadline - Date.now())
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc)
  const local = pc.localDescription
  if (!local) throw new Error('no local description')
  const offer: Description = { type: local.type, sdp: local.sdp }
  // A gateway that predates pieces leaves them out of its answer.
  const { answer, pieces } = (await call(mid, 'isbell.rtc.offer', { offer, pieces: true }, left())) as {
    answer: Description
    pieces?: boolean
  }
  await pc.setRemoteDescription(answer)
  // The channel opens after ICE and DTLS, in a later task, so listening from here misses nothing.
  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no direct link within ${DIRECT_MS / 1000}s`)), left())
    channel.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
  await opened
  return pieces === true
}

/** Candidates are not trickled: wait for the end of gathering, SETTLE_MS past the first public
 * address, or GATHER_MS, so the offer carries the public addresses of both families. */
const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>(resolve => {
    let settling: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      clearTimeout(timer)
      clearTimeout(settling)
      resolve()
    }
    const timer = setTimeout(done, GATHER_MS)
    pc.addEventListener('icecandidate', e => {
      if (!e.candidate) done()
      else if (e.candidate.type === 'srflx' && settling === undefined) settling = setTimeout(done, SETTLE_MS)
    })
    if (pc.iceGatheringState === 'complete') done()
  })

/** The browser hides its own addresses, so only the machine's end tells. */
async function pathOfLink(pc: RTCPeerConnection): Promise<Path> {
  const remote = chosenPair(await pc.getStats())?.remote
  return remote ? pathOf(endpoint(remote)) : 'internet'
}

/** A candidate as the stats report it; older browsers name the address `ip`. */
type Candidate = { candidateType: string; protocol: string; address?: string; ip?: string }

const endpoint = ({ candidateType, address, ip }: Candidate): Endpoint => {
  const at = address ?? ip
  return at ? { type: candidateType, address: at } : { type: candidateType }
}

/** The pair ICE nominated, with the candidate at each end. */
function chosenPair(stats: RTCStatsReport) {
  const pair = [...stats.values()].find(
    s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated,
  )
  const local: Candidate | undefined = pair && stats.get(pair.localCandidateId)
  const remote: Candidate | undefined = pair && stats.get(pair.remoteCandidateId)
  if (!local || !remote) return undefined
  const rtt: number | undefined = pair.currentRoundTripTime
  return { rtt, local, remote }
}

async function statsOf(pc: RTCPeerConnection): Promise<LinkStats | undefined> {
  const chosen = chosenPair(await pc.getStats())
  if (!chosen) return undefined
  const { rtt, local, remote } = chosen
  return {
    rttMs: rtt === undefined ? undefined : Math.round(rtt * 1000),
    local: endpoint(local),
    remote: endpoint(remote),
    protocol: local.protocol,
  }
}

function carry(pc: RTCPeerConnection, channel: RTCDataChannel, path: Path, pieces: boolean): DirectLink {
  // A frame sent while the channel closes is lost with the link, whose streams end anyway. A send
  // that fails (a full send queue) ends the link, as the gateway's does: the rest of the frame
  // would be missing, and the gateway would drop what came after it.
  const router = createRouter(frame => {
    if (channel.readyState !== 'open') return
    try {
      for (const msg of pieces ? split(frame) : [encode(frame)]) {
        if (typeof msg === 'string') channel.send(msg)
        else channel.send(msg)
      }
    } catch (err) {
      console.error('a direct send failed; ending the link', err)
      finish()
    }
  }, false)
  const assemble = createAssembler()
  let end: () => void = () => {}
  const closed = new Promise<void>(resolve => {
    end = resolve
  })
  let over = false
  const finish = () => {
    if (over) return
    over = true
    router.fail(() => true, 'disconnected', 'lost the direct link to the machine')
    channel.close()
    pc.close()
    end()
  }
  channel.addEventListener('message', e => {
    try {
      const frame = assemble(e.data as ArrayBuffer | string)
      if (frame) router.handle(frame)
    } catch (err) {
      console.warn('ignoring an unreadable direct message', err)
    }
  })
  channel.addEventListener('close', finish)
  // `disconnected` may recover on its own; only failed or closed is the end.
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish()
  })
  return {
    path,
    pieces,
    // The router's `mid` only matches streams to their machine; a direct link has one machine.
    open: (m, p, timeoutMs, events) => router.open('', m, p, timeoutMs, events),
    call: (m, p, timeoutMs) => router.call('', m, p, timeoutMs),
    stats: () => statsOf(pc),
    close: finish,
    closed,
  }
}
