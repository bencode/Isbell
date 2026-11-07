import { afterEach, expect, test, vi } from 'vitest'
import { openDirect } from './direct'

type CandidateEvent = { after: number; address: string } | { after: number; complete: true }

const v4 = '192.0.2.1'
const v6 = '2001:db8::1'

/** The browser gathers candidates on a controlled clock; the RPC records the offer it receives. */
function browser(events: CandidateEvent[]) {
  const offers: string[] = []
  class Peer extends EventTarget {
    localDescription = { type: 'offer', sdp: '' }
    iceGatheringState = 'gathering'
    connectionState = 'connecting'
    channel = Object.assign(new EventTarget(), {
      binaryType: '',
      readyState: 'connecting',
      close: () => {},
    })

    createDataChannel() {
      return this.channel
    }

    async createOffer() {
      return this.localDescription
    }

    async setLocalDescription() {
      events.forEach(event => {
        setTimeout(() => {
          if ('complete' in event) {
            this.iceGatheringState = 'complete'
            this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: null }))
          } else {
            this.localDescription.sdp += `a=candidate:1 1 udp 1 ${event.address} 1234 typ srflx\r\n`
            const candidate = { type: 'srflx', address: event.address }
            this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate }))
          }
        }, event.after)
      })
    }

    async setRemoteDescription() {
      setTimeout(() => {
        this.channel.readyState = 'open'
        this.channel.dispatchEvent(new Event('open'))
      }, 0)
    }

    async getStats() {
      return new Map<string, RTCStats>()
    }

    close() {}
  }
  vi.stubGlobal('RTCPeerConnection', Peer)
  const call = async (_mid: string, _method: string, params: unknown) => {
    offers.push((params as { offer: { sdp: string } }).offer.sdp)
    return { answer: { type: 'answer', sdp: '' }, pieces: true }
  }
  return { offers, opened: openDirect(call, 'machine') }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test.each([
  [v4, v6],
  [v6, v4],
])('the offer includes the late address family after %s arrives first', async (first, second) => {
  vi.useFakeTimers()
  const { offers, opened } = browser([
    { after: 10, address: first },
    { after: 800, address: second },
  ])
  await vi.advanceTimersByTimeAsync(600)
  expect(offers).toEqual([])
  await vi.advanceTimersByTimeAsync(1_000)
  const link = await opened
  expect(offers).toHaveLength(1)
  expect(offers[0]).toContain(v4)
  expect(offers[0]).toContain(v6)
  link.close()
})

test('a single-family offer goes out when gathering completes', async () => {
  vi.useFakeTimers()
  const { offers, opened } = browser([
    { after: 10, address: v4 },
    { after: 20, complete: true },
  ])
  await vi.advanceTimersByTimeAsync(100)
  const link = await opened
  expect(offers).toHaveLength(1)
  expect(offers[0]).toContain(v4)
  link.close()
})

test('a missing address family does not hold the offer beyond the gathering budget', async () => {
  vi.useFakeTimers()
  const { offers, opened } = browser([{ after: 10, address: v4 }])
  await vi.advanceTimersByTimeAsync(2_000)
  expect(offers).toEqual([])
  await vi.advanceTimersByTimeAsync(600)
  const link = await opened
  expect(offers).toHaveLength(1)
  expect(offers[0]).toContain(v4)
  link.close()
})
