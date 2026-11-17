'use client'

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

const RECORDER_TIMESLICE_MS = 1_000
const sliced = (mimeType: string): boolean => mimeType.startsWith('audio/webm')

const LEVEL_SAMPLE_MS = 60

export interface UseDictationOptions {
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
  cancelled: boolean
}

type AudioContextConstructor = new () => AudioContext

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
    if (sliced(mimeType)) recorder.start(RECORDER_TIMESLICE_MS)
    else recorder.start()
    session.startedAt = Date.now()
    session.ticker = setInterval(() => {
      const level = session.meter?.read() ?? 0
      const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000)
      sendBack({ type: 'level.sampled', level, elapsedSeconds })
    }, LEVEL_SAMPLE_MS)
    sendBack({ type: 'microphone.opened' })
  }

  const open = async () => {
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      if (session.cancelled) return release(session)
      session.meter = attachMeter(context, session.stream)
      if (!session.meter) void context?.close().catch(() => {})
      record(session.stream)
    } catch (error) {
      const meterAttached = session.meter !== null
      release(session)
      if (!meterAttached) void context?.close().catch(() => {})
      if (!session.cancelled) sendBack({ type: 'microphone.failed', key: startErrorKey(error) })
    }
  }
  void open()

  return {
    stop: () => {
      const recorder = session.recorder
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
    finish,
    cancel: () => {
      session.cancelled = true
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
  const [snapshot, send] = useMachine(machine)

  const state = useMemo(() => dictationStateOf(snapshot), [snapshot])
  const toggle = useCallback(() => send({ type: 'toggle' }), [send])

  return { state, toggle }
}
