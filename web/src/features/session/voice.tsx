// Voice input: a recording, sent to the speech service the app is built with (VITE_VOICE_URL), comes
// back as tidied text. Without the service, or a browser that records, there is no voice input.

import { LoaderCircle, Mic, Square } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { errorText, useI18n } from '../../core/i18n'
import { MAC } from '../../utils/command-key'

const VOICE_URL = import.meta.env.VITE_VOICE_URL
// The service takes five minutes at most.
const MAX_MS = 5 * 60_000

/** The key a tap of which starts and stops voice input in a terminal. */
export const VOICE_KEY = MAC ? '⌥' : 'Alt'

export type VoiceState = 'idle' | 'recording' | 'working'
export type Voice = ReturnType<typeof useVoice>

type Reply = { raw: string; polished: string } | { error: string }
type Taking = { recorder: MediaRecorder; audio: AudioContext; timer: number }

/** Records on the first `toggle`, and on the second sends the recording, which comes back to
 * `onText`; five minutes' recording stops by itself. `heard`: the voice as it is being recorded. */
export function useVoice(onText: (text: string) => void) {
  const t = useI18n()
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string>()
  const [heard, setHeard] = useState<AnalyserNode>()
  const taking = useRef<Taking | null>(null)
  // Asking for the microphone: the page stays clickable while the browser asks.
  const opening = useRef(false)
  // Gone while the browser asked: the microphone it gives is let go at once.
  const gone = useRef(false)
  const available =
    !!VOICE_URL && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  // Leaving while recording drops the recording and lets go of the microphone.
  useEffect(() => {
    // Mounted again (StrictMode mounts twice), it is here after all.
    gone.current = false
    return () => {
      gone.current = true
      const held = taking.current
      if (!held) return
      held.recorder.onstop = null
      held.recorder.stop()
      release(held)
    }
  }, [])

  const send = async (audio: Blob) => {
    setState('working')
    try {
      const body = new FormData()
      body.append('audio', audio)
      const res = await fetch(`${VOICE_URL}/v1/transcribe`, { method: 'POST', body })
      // A proxy in front of a service that is down answers with a page, not the service's JSON.
      const reply: Reply = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : { error: `${res.status} ${res.statusText}` }
      // Over the minute's recordings, or the day's minutes: told apart by how long to wait.
      if (res.status === 429)
        setError(t(Number(res.headers.get('retry-after')) > 60 ? 'voice.usedUp' : 'voice.limited'))
      else if ('error' in reply) setError(t('error.unknown', { msg: reply.error }))
      else if (!reply.polished) setError(t('voice.empty'))
      else onText(reply.polished)
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setState('idle')
    }
  }

  const start = async () => {
    setError(undefined)
    let stream: MediaStream
    opening.current = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError' ? t('voice.denied') : errorText(t, err),
      )
      return
    } finally {
      opening.current = false
    }
    if (gone.current) return stopTracks(stream)
    const recorder = new MediaRecorder(stream)
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    audio.createMediaStreamSource(stream).connect(analyser)
    const chunks: Blob[] = []
    recorder.ondataavailable = e => chunks.push(e.data)
    recorder.onstop = () => {
      if (taking.current) release(taking.current)
      taking.current = null
      setHeard(undefined)
      void send(new Blob(chunks, { type: recorder.mimeType }))
    }
    taking.current = { recorder, audio, timer: window.setTimeout(() => recorder.stop(), MAX_MS) }
    recorder.start()
    setHeard(analyser)
    setState('recording')
  }

  const toggle = () => {
    if (state === 'recording') taking.current?.recorder.stop()
    else if (state === 'idle' && !opening.current) void start()
  }

  return { available, state, toggle, error, heard }
}

function release({ recorder, audio, timer }: Taking) {
  clearTimeout(timer)
  stopTracks(recorder.stream)
  audio.close().catch((err: unknown) => console.error('could not close the audio context', err))
}

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop()
}

/** `action` on a tap of the voice key alone: pressed and let go with no other key or click between,
 * so that ⌥← and ⌥-click stay the terminal's. Spread on what holds the terminal; caught on the way
 * down. */
export function useVoiceKey(action: () => void) {
  const alone = useRef(false)
  return {
    onPointerDownCapture: () => {
      alone.current = false
    },
    onKeyDownCapture: (e: KeyboardEvent) => {
      if (e.key !== 'Alt') alone.current = false
      else if (!e.repeat) alone.current = true
    },
    onKeyUpCapture: (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || !alone.current) return
      alone.current = false
      // Elsewhere a tap of Alt alone opens the browser's menu.
      e.preventDefault()
      action()
    },
  }
}

/** What the voice button says it will do, or is doing. */
export const VOICE_LABEL = { idle: 'voice.start', recording: 'voice.stop', working: 'voice.working' } as const

export function VoiceIcon({ state, size }: { state: VoiceState; size: number }) {
  if (state === 'recording') return <Square size={size - 4} fill="currentColor" />
  if (state === 'working')
    return <LoaderCircle size={size} className="animate-spin motion-reduce:animate-none" />
  return <Mic size={size} />
}

/** Voice input under way, over where its words will land: the voice as it is heard and for how long,
 * then the wait for its words. `hint`: how to stop. Placed by `className`; nothing while idle. */
export function VoicePill({ voice, hint, className }: { voice: Voice; hint?: string; className: string }) {
  const t = useI18n()
  if (voice.state === 'idle') return null
  return (
    <div
      role="status"
      className={`pointer-events-none z-10 flex items-center gap-2.5 rounded-full border border-white/10 bg-[#11151d]/90 px-3.5 py-1.5 font-mono text-xs whitespace-nowrap text-[#e9e5d9] shadow-lg ${className}`}
    >
      {voice.state === 'recording' && voice.heard ? (
        <>
          <span className="size-2 flex-none animate-pulse rounded-full bg-[#ff5f56] motion-reduce:animate-none" />
          <Meter heard={voice.heard} />
          <Elapsed />
          {hint ? <span className="text-[#9aa4b8]">{hint}</span> : null}
        </>
      ) : (
        <>
          <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" />
          {t('voice.working')}
        </>
      )}
    </div>
  )
}

const BARS = 14
const BAR_SLOTS = Array.from({ length: BARS }, (_, i) => i)
// A bar a step, so the voice runs from right to left.
const STEP_MS = 60

/** The voice as it is heard, the loudest of each step a bar. Drawn straight onto the bars, not
 * through React, many times a second. */
function Meter({ heard }: { heard: AnalyserNode }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const samples = new Uint8Array(heard.fftSize)
    const levels = Array<number>(BARS).fill(0)
    let loudest = 0
    let stepped = performance.now()
    let frame = requestAnimationFrame(function draw(now) {
      heard.getByteTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, s) => sum + ((s - 128) / 128) ** 2, 0) / samples.length)
      loudest = Math.max(loudest, Math.min(1, rms * 5))
      if (now - stepped >= STEP_MS) {
        levels.shift()
        levels.push(loudest)
        loudest = 0
        stepped = now
        levels.forEach((level, i) => {
          const bar = bars.current[i]
          if (bar) bar.style.transform = `scaleY(${0.15 + level * 0.85})`
        })
      }
      frame = requestAnimationFrame(draw)
    })
    return () => cancelAnimationFrame(frame)
  }, [heard])
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
      {BAR_SLOTS.map(i => (
        <span
          key={i}
          ref={el => {
            bars.current[i] = el
          }}
          className="h-full w-[2px] origin-center scale-y-[0.15] rounded-full bg-[#e9e5d9] transition-transform duration-75"
        />
      ))}
    </span>
  )
}

/** Minutes and seconds since it was first shown. */
function Elapsed() {
  const [since] = useState(() => Date.now())
  const [now, setNow] = useState(since)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.floor((now - since) / 1000)
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}
