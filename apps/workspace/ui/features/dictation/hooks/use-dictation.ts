'use client'

/**
 * One microphone button's lifecycle: check support, record up to 45 seconds,
 * send, hand the text back. The composer only ever sees `onTranscript` with
 * text to insert, or `onError` with a message key; it never sees audio.
 *
 * Silence is decided here, before anything is sent: a recording shorter than
 * {@link MIN_RECORDING_MS}, or whose loudest moment stayed under
 * {@link SILENCE_RMS}, inserts nothing and costs nothing. Transcription models
 * invent text over silence (subtitle credits, "Thank you."), so not sending it
 * is the reliable half; the backend drops the known phrases as the other.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import { fromCallback, fromPromise } from 'xstate'
import { DICTATION_AUDIO_BITS_PER_SECOND } from '@/lib/dictation/contract'
import { requestDictation, type DictationOutcome } from '../lib/client'
import {
  dictationMachine,
  dictationStateOf,
  type CaptureCommand,
  type CaptureEvent,
  type CaptureInput,
  type DictationErrorKey,
  type TranscriptionInput,
} from '../lib/dictation-machine'
import { detectRecordingSupport, isMicrophoneDenied, type RecordingSupport } from '../lib/recording-support'

export {
  MIN_RECORDING_MS,
  SILENCE_RMS,
  WAVE_BARS,
  heldSpeech,
  waveHeight,
  type DictationErrorKey,
  type DictationState,
} from '../lib/dictation-machine'

/** How often the level is read: the silence gate's sample rate and the waveform's frame rate. */
const LEVEL_SAMPLE_MS = 60

export interface UseDictationOptions {
  /** The UI language, sent as a wording hint. Never fixes the transcription language. */
  locale: string
  onTranscript: (text: string) => void
  onError: (key: DictationErrorKey) => void
}

interface LevelMeter {
  context: AudioContext
  read: () => number
}

interface RecordingSession {
  stream: MediaStream | null
  recorder: MediaRecorder | null
  meter: LevelMeter | null
  chunks: Blob[]
  startedAt: number
  ticker: ReturnType<typeof setInterval> | null
  /** Set when the machine left the capture, or the button unmounted: nothing is reported after it. */
  cancelled: boolean
}

type AudioContextConstructor = new () => AudioContext

/** Created inside the click, before any await: Safari starts a context made later suspended. */
function createAudioContext(): AudioContext | null {
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }
  const Context = scope.AudioContext ?? scope.webkitAudioContext
  if (!Context) return null
  try {
    return new Context()
  } catch {
    return null
  }
}

function attachMeter(context: AudioContext | null, stream: MediaStream): LevelMeter | null {
  if (!context) return null
  try {
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    context.createMediaStreamSource(stream).connect(analyser)
    void context.resume().catch(() => {})
    const samples = new Float32Array(analyser.fftSize)
    return {
      context,
      read: () => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += sample * sample
        return Math.sqrt(sum / samples.length)
      },
    }
  } catch {
    return null
  }
}

/** Lets go of whatever the session still holds. Safe to call again: a stream that arrives late is released by a second call. */
function release(session: RecordingSession): void {
  if (session.ticker) clearInterval(session.ticker)
  session.ticker = null
  session.stream?.getTracks().forEach((track) => track.stop())
  session.stream = null
  void session.meter?.context.close().catch(() => {})
  session.meter = null
}

function startErrorKey(error: unknown): DictationErrorKey {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noMicrophone'
  return 'failed'
}

async function checkSupport(): Promise<RecordingSupport> {
  const support = detectRecordingSupport(window)
  if (!support.available) return support
  const denied = await isMicrophoneDenied(navigator.permissions)
  return denied ? { available: false, reason: 'denied' } : support
}

/**
 * The microphone for one recording: opens it, records, samples the level, and
 * reports each step to the machine. The machine stops it by leaving the state
 * that invoked it, which is also what an unmount does.
 */
function captureMicrophone(
  mimeType: string,
  sendBack: (event: CaptureEvent) => void,
): { stop: () => void; finish: () => void; cancel: () => void } {
  const session: RecordingSession = {
    stream: null,
    recorder: null,
    meter: null,
    chunks: [],
    startedAt: Date.now(),
    ticker: null,
    cancelled: false,
  }
  // Runs inside the click that started the machine's `capturing` state, before any await.
  const context = createAudioContext()

  const finish = () => {
    const durationMs = Date.now() - session.startedAt
    const meterTrusted = session.meter?.context.state === 'running'
    release(session)
    if (session.cancelled) return
    const audio = new Blob(session.chunks, { type: session.recorder?.mimeType || mimeType })
    sendBack({ type: 'recording.finished', audio, durationMs, meterTrusted })
  }

  const record = (stream: MediaStream) => {
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: DICTATION_AUDIO_BITS_PER_SECOND })
    session.recorder = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data)
    }
    recorder.onstop = finish
    recorder.start()
    session.startedAt = Date.now()
    session.ticker = setInterval(() => {
      const level = session.meter?.read() ?? 0
      const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000)
      // Only this button re-renders: the state lives in its machine, not in the composer.
      sendBack({ type: 'level.sampled', level, elapsedSeconds })
    }, LEVEL_SAMPLE_MS)
    sendBack({ type: 'microphone.opened' })
  }

  const open = async () => {
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      // Given up on while the prompt was open: `cancel` closed the context, and the stream goes straight back.
      if (session.cancelled) return release(session)
      session.meter = attachMeter(context, session.stream)
      if (!session.meter) void context?.close().catch(() => {})
      record(session.stream)
    } catch (error) {
      const meterAttached = session.meter !== null
      release(session)
      if (!meterAttached) void context?.close().catch(() => {})
      // A refusal that lands after the person gave up, or left, is said to nobody: the
      // composer it would reach is gone or has moved on, and the next press learns it afresh.
      if (!session.cancelled) sendBack({ type: 'microphone.failed', key: startErrorKey(error) })
    }
  }
  void open()

  return {
    stop: () => {
      const recorder = session.recorder
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
    // For a recorder that never fired `onstop`: report what arrived, as `onstop` would have.
    finish,
    cancel: () => {
      session.cancelled = true
      // Until a stream arrives the context belongs to no meter, and a microphone that never answers would keep it open.
      if (!session.meter) void context?.close().catch(() => {})
      release(session)
    },
  }
}

export function useDictation({ locale, onTranscript, onError }: UseDictationOptions) {
  const callbacks = useRef({ locale, onTranscript, onError })
  useEffect(() => {
    callbacks.current = { locale, onTranscript, onError }
  }, [locale, onTranscript, onError])

  // Provided once: the actor keeps the machine it was created with, and each implementation reads the latest callbacks.
  const [machine] = useState(() =>
    dictationMachine.provide({
      actors: {
        checkSupport: fromPromise<RecordingSupport>(checkSupport),
        capture: fromCallback<CaptureCommand, CaptureInput>(({ input, sendBack, receive }) => {
          const capture = captureMicrophone(input.mimeType, sendBack)
          receive((command) => (command.type === 'stop' ? capture.stop() : capture.finish()))
          return capture.cancel
        }),
        transcribe: fromPromise<DictationOutcome, TranscriptionInput>(({ input, signal }) =>
          requestDictation({ ...input, locale: callbacks.current.locale }, signal),
        ),
      },
      actions: {
        notifyTranscript: (_, { text }) => callbacks.current.onTranscript(text),
        notifyError: (_, { key }) => callbacks.current.onError(key),
      },
    }),
  )
  // Starts on mount and stops on unmount, which cancels the capture and aborts a request in flight.
  const [snapshot, send] = useMachine(machine)

  const state = useMemo(() => dictationStateOf(snapshot), [snapshot])
  const toggle = useCallback(() => send({ type: 'toggle' }), [send])

  return { state, toggle }
}
