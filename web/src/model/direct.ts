// A direct link to one machine: a WebRTC DataChannel set up through the relay with the gateway's
// `isbell.rtc.offer`. Frames on it are the relay's frames without routing fields, one per message.

import { decode, encode } from './frame'
import type { Caller } from './herdr'
import { type Endpoint, type Path, pathOf } from './path'
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
  open: (m: string, p: unknown, timeoutMs: number, events: StreamEvents) => Promise<Opened>
  /** Undefined once no pair is chosen, as when the link is going. */
  stats: () => Promise<LinkStats | undefined>
  close: () => void
  /** Settles once the link is gone, whichever side ended it. */
  closed: Promise<void>
}

/** The gateway's default STUN servers, so both sides look for their public addresses alike. */
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
/** The offer goes out once gathering completes, or after this, as the gateway does. */
const GATHER_MS = 2_500
/** Offer, answer and the channel opening together, as the CLI allows. */
const DIRECT_MS = 10_000

type Description = { type: RTCSdpType; sdp: string }

export async function openDirect(call: Caller, mid: string): Promise<DirectLink> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] })
  const channel = pc.createDataChannel('isbell')
  channel.binaryType = 'arraybuffer'
  try {
    await connect(pc, channel, call, mid, Date.now() + DIRECT_MS)
    return carry(pc, channel, await pathOfLink(pc))
  } catch (err) {
    pc.close()
    throw new CallError('direct_failed', err instanceof Error ? err.message : String(err))
  }
}

/** Every step is bounded, so this settles by `deadline` (plus at most the gathering). */
async function connect(
  pc: RTCPeerConnection,
  channel: RTCDataChannel,
  call: Caller,
  mid: string,
  deadline: number,
) {
  const left = () => Math.max(0, deadline - Date.now())
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc)
  const local = pc.localDescription
  if (!local) throw new Error('no local description')
  const offer: Description = { type: local.type, sdp: local.sdp }
  const { answer } = (await call(mid, 'isbell.rtc.offer', { offer }, left())) as { answer: Description }
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
}

/** Candidates are not trickled: wait for the end of gathering, or GATHER_MS, so the offer carries
 * every address found, of both families. */
const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, GATHER_MS)
    pc.addEventListener('icecandidate', e => {
      if (!e.candidate) done()
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

function carry(pc: RTCPeerConnection, channel: RTCDataChannel, path: Path): DirectLink {
  // A frame sent while the channel closes is lost with the link, whose streams end anyway.
  const router = createRouter(frame => {
    if (channel.readyState !== 'open') return
    const data = encode(frame)
    if (typeof data === 'string') channel.send(data)
    else channel.send(data)
  }, false)
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
      router.handle(decode(e.data as ArrayBuffer | string))
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
    // The router's `mid` only matches streams to their machine; a direct link has one machine.
    open: (m, p, timeoutMs, events) => router.open('', m, p, timeoutMs, events),
    stats: () => statsOf(pc),
    close: finish,
    closed,
  }
}
