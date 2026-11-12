/**
 * The dictation statechart against fake actors: a support check, a microphone
 * and a transcription the test settles by hand. Every state is entered, every
 * declared event is sent in every state, and what a state does not declare is
 * shown to be ignored.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createActor, fromCallback, fromPromise } from 'xstate'
import { MAX_DICTATION_SECONDS } from '@/lib/dictation/contract'
import type { DictationOutcome } from './client'
import {
  MICROPHONE_ANSWER_LIMIT_MS,
  MIN_RECORDING_MS,
  SILENCE_RMS,
  STOP_LIMIT_MS,
  WAVE_BARS,
  dictationMachine,
  dictationStateOf,
  heardSpeech,
  heldSpeech,
  waveHeight,
  type CaptureCommand,
  type CaptureEvent,
  type CaptureInput,
  type DictationEvent,
  type TranscriptionInput,
} from './dictation-machine'
import type { RecordingSupport } from './recording-support'

const SUPPORTED: RecordingSupport = { available: true, mimeType: 'audio/webm', format: 'webm' }
const AUDIO = new Blob([new Uint8Array(64)])

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function harness() {
  const check = deferred<RecordingSupport>()
  const transcription = deferred<DictationOutcome>()
  const capture = {
    inputs: [] as CaptureInput[],
    commands: [] as CaptureCommand[],
    released: 0,
    report: (_event: CaptureEvent) => {},
  }
  const transcribe = { inputs: [] as TranscriptionInput[], signal: null as AbortSignal | null }
  const onTranscript = vi.fn<(text: string) => void>()
  const onError = vi.fn<(key: string) => void>()

  const actor = createActor(
    dictationMachine.provide({
      actors: {
        checkSupport: fromPromise<RecordingSupport>(() => check.promise),
        capture: fromCallback<CaptureCommand, CaptureInput>(({ input, sendBack, receive }) => {
          capture.inputs.push(input)
          capture.report = sendBack
          receive((command) => capture.commands.push(command))
          return () => {
            capture.released += 1
          }
        }),
        transcribe: fromPromise<DictationOutcome, TranscriptionInput>(({ input, signal }) => {
          transcribe.inputs.push(input)
          transcribe.signal = signal
          return transcription.promise
        }),
      },
      actions: {
        notifyTranscript: (_, { text }) => onTranscript(text),
        notifyError: (_, { key }) => onError(key),
      },
    }),
  )
  actor.start()

  const phase = () => dictationStateOf(actor.getSnapshot()).phase
  const settle = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }
  const toIdle = async () => {
    check.resolve(SUPPORTED)
    await settle()
  }
  const toStarting = async () => {
    await toIdle()
    actor.send({ type: 'toggle' })
  }
  const toRecording = async () => {
    await toStarting()
    capture.report({ type: 'microphone.opened' })
  }
  const toTranscribing = async () => {
    await toRecording()
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 2000, meterTrusted: false })
  }
  return { actor, check, transcription, capture, transcribe, onTranscript, onError, phase, settle, toIdle, toStarting, toRecording, toTranscribing }
}

const EVERY_EVENT: DictationEvent[] = [
  { type: 'toggle' },
  { type: 'microphone.opened' },
  { type: 'microphone.failed', key: 'failed' },
  { type: 'level.sampled', level: 0.2, elapsedSeconds: 3 },
  { type: 'recording.finished', audio: AUDIO, durationMs: 2000, meterTrusted: false },
]

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checking', () => {
  test('is where the machine starts, and no event moves it', () => {
    const { actor, phase, capture } = harness()
    for (const event of EVERY_EVENT) actor.send(event)
    expect(phase()).toBe('checking')
    expect(capture.inputs).toHaveLength(0)
  })

  test('a browser that can record becomes idle', async () => {
    const { toIdle, phase } = harness()
    await toIdle()
    expect(phase()).toBe('idle')
  })

  test('a browser that cannot becomes unavailable with the reason', async () => {
    const { actor, check, settle } = harness()
    check.resolve({ available: false, reason: 'noFormat' })
    await settle()
    expect(dictationStateOf(actor.getSnapshot())).toEqual({ phase: 'unavailable', reason: 'noFormat' })
  })

  test('a check that throws is an unsupported browser', async () => {
    const { actor, check, settle } = harness()
    check.reject(new Error('no permissions API'))
    await settle()
    expect(dictationStateOf(actor.getSnapshot())).toEqual({ phase: 'unavailable', reason: 'unsupported' })
  })
})

describe('unavailable', () => {
  test('no event leaves it', async () => {
    const { actor, check, settle, phase, capture } = harness()
    check.resolve({ available: false, reason: 'denied' })
    await settle()
    for (const event of EVERY_EVENT) actor.send(event)
    expect(phase()).toBe('unavailable')
    expect(capture.inputs).toHaveLength(0)
  })
})

describe('idle', () => {
  test('only a toggle leaves it', async () => {
    const { actor, toIdle, phase } = harness()
    await toIdle()
    for (const event of EVERY_EVENT.slice(1)) actor.send(event)
    expect(phase()).toBe('idle')
  })

  test('a toggle opens the microphone in the same call, with the format the check found', async () => {
    const { actor, toIdle, phase, capture } = harness()
    await toIdle()
    actor.send({ type: 'toggle' })
    // Synchronous: Safari suspends an audio context created after the click returned.
    expect(capture.inputs).toEqual([{ mimeType: 'audio/webm' }])
    expect(phase()).toBe('starting')
  })
})

describe('starting', () => {
  test('ignores a level and a finished recording', async () => {
    const { actor, toStarting, phase, capture } = harness()
    await toStarting()
    actor.send({ type: 'level.sampled', level: 0.2, elapsedSeconds: 3 })
    actor.send({ type: 'recording.finished', audio: AUDIO, durationMs: 2000, meterTrusted: false })
    expect(phase()).toBe('starting')
    expect(capture.inputs).toHaveLength(1)
    expect(capture.commands).toHaveLength(0)
  })

  // A permission prompt left unanswered, or hidden behind another window, never settles.
  test('a second toggle gives up: back to idle, the capture released, nothing said', async () => {
    const { actor, toStarting, phase, capture, onError } = harness()
    await toStarting()
    actor.send({ type: 'toggle' })
    expect(phase()).toBe('idle')
    expect(capture.released).toBe(1)
    expect(onError).not.toHaveBeenCalled()
    // What the abandoned microphone reports later belongs to nobody.
    capture.report({ type: 'microphone.failed', key: 'denied' })
    capture.report({ type: 'microphone.opened' })
    expect(phase()).toBe('idle')
    expect(onError).not.toHaveBeenCalled()
  })

  test('after giving up, the next toggle opens the microphone afresh', async () => {
    const { actor, toStarting, phase, capture } = harness()
    await toStarting()
    actor.send({ type: 'toggle' })
    actor.send({ type: 'toggle' })
    expect(phase()).toBe('starting')
    expect(capture.inputs).toHaveLength(2)
    capture.report({ type: 'microphone.opened' })
    expect(phase()).toBe('recording')
  })

  test('a microphone that never answers ends by itself, releases the capture and says so', async () => {
    const { toStarting, phase, capture, onError } = harness()
    await toStarting()
    vi.advanceTimersByTime(MICROPHONE_ANSWER_LIMIT_MS - 1)
    expect(phase()).toBe('starting')
    vi.advanceTimersByTime(1)
    expect(phase()).toBe('idle')
    expect(onError.mock.calls).toEqual([['noAnswer']])
    expect(capture.released).toBe(1)
  })

  test('the answer limit is long enough for a person reading a permission prompt', () => {
    expect(MICROPHONE_ANSWER_LIMIT_MS).toBeGreaterThanOrEqual(60_000)
  })

  test('a microphone that answered in time is not ended by the answer limit', async () => {
    const { toRecording, phase, onError } = harness()
    await toRecording()
    vi.advanceTimersByTime(MAX_DICTATION_SECONDS * 1000 - 1)
    expect(phase()).toBe('recording')
    expect(onError).not.toHaveBeenCalled()
  })

  test('an opened microphone is a recording at zero seconds with a flat wave', async () => {
    const { actor, toRecording } = harness()
    await toRecording()
    expect(dictationStateOf(actor.getSnapshot())).toEqual({
      phase: 'recording',
      elapsedSeconds: 0,
      levels: Array.from({ length: WAVE_BARS }, () => 0),
    })
  })

  test('a refused microphone is unavailable, says so once and releases the capture', async () => {
    const { actor, toStarting, capture, onError } = harness()
    await toStarting()
    capture.report({ type: 'microphone.failed', key: 'denied' })
    expect(dictationStateOf(actor.getSnapshot())).toEqual({ phase: 'unavailable', reason: 'denied' })
    expect(onError.mock.calls).toEqual([['denied']])
    expect(capture.released).toBe(1)
  })

  test.each(['noMicrophone', 'failed'] as const)('a microphone that fails with %s returns to idle and says so', async (key) => {
    const { toStarting, capture, onError, phase } = harness()
    await toStarting()
    capture.report({ type: 'microphone.failed', key })
    expect(phase()).toBe('idle')
    expect(onError.mock.calls).toEqual([[key]])
    expect(capture.released).toBe(1)
  })
})

describe('recording', () => {
  test('a level sample moves the clock, shifts the wave and raises the peak', async () => {
    const { actor, toRecording, capture } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: 0.25, elapsedSeconds: 2 })
    capture.report({ type: 'level.sampled', level: 0.01, elapsedSeconds: 3 })
    const state = dictationStateOf(actor.getSnapshot())
    expect(state).toMatchObject({ phase: 'recording', elapsedSeconds: 3 })
    if (state.phase !== 'recording') return
    expect(state.levels).toHaveLength(WAVE_BARS)
    expect(state.levels.slice(-2)).toEqual([1, waveHeight(0.01)])
    expect(actor.getSnapshot().context.peak).toBe(0.25)
  })

  test('ignores the microphone opening or failing again', async () => {
    const { actor, toRecording, phase, onError } = harness()
    await toRecording()
    actor.send({ type: 'microphone.opened' })
    actor.send({ type: 'microphone.failed', key: 'denied' })
    expect(phase()).toBe('recording')
    expect(onError).not.toHaveBeenCalled()
  })

  test('a toggle asks the recorder to stop once and keeps showing the recording', async () => {
    const { actor, toRecording, phase, capture } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    actor.send({ type: 'toggle' })
    expect(capture.commands).toEqual([{ type: 'stop' }])
    expect(actor.getSnapshot().matches({ capturing: { recording: 'stopping' } })).toBe(true)
    expect(phase()).toBe('recording')
    // The ticker still runs until the recorder reports.
    capture.report({ type: 'level.sampled', level: 0.1, elapsedSeconds: 5 })
    expect(dictationStateOf(actor.getSnapshot())).toMatchObject({ elapsedSeconds: 5 })
  })

  test(`asks the recorder to stop by itself after ${MAX_DICTATION_SECONDS} seconds`, async () => {
    const { toRecording, capture } = harness()
    await toRecording()
    vi.advanceTimersByTime(MAX_DICTATION_SECONDS * 1000 - 1)
    expect(capture.commands).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(capture.commands).toEqual([{ type: 'stop' }])
  })

  test('the limit does not ask twice after a toggle already did', async () => {
    const { actor, toRecording, capture } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(MAX_DICTATION_SECONDS * 1000)
    expect(capture.commands.filter((command) => command.type === 'stop')).toHaveLength(1)
  })

  test('a recorder that does not report its stop is asked once to hand over what it has', async () => {
    const { actor, toRecording, capture, phase } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(STOP_LIMIT_MS - 1)
    expect(capture.commands).toEqual([{ type: 'stop' }])
    vi.advanceTimersByTime(1)
    expect(capture.commands).toEqual([{ type: 'stop' }, { type: 'finish' }])
    expect(phase()).toBe('recording')
    vi.advanceTimersByTime(STOP_LIMIT_MS * 10)
    expect(capture.commands).toHaveLength(2)
  })

  test('what a silent recorder had captured is sent', async () => {
    const { actor, toRecording, capture, transcribe, phase } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(STOP_LIMIT_MS)
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 2500, meterTrusted: false })
    expect(phase()).toBe('transcribing')
    expect(transcribe.inputs).toEqual([{ audio: AUDIO, format: 'webm', durationMs: 2500 }])
  })

  test('a recorder that hung on a recording the meter heard a voice in says it could not be saved', async () => {
    const { actor, toRecording, capture, transcribe, onError, phase } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: SILENCE_RMS * 20, elapsedSeconds: 1 })
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(STOP_LIMIT_MS)
    expect(actor.getSnapshot().matches({ capturing: { recording: 'forced' } })).toBe(true)
    capture.report({ type: 'recording.finished', audio: new Blob([]), durationMs: 2500, meterTrusted: true })
    expect(phase()).toBe('idle')
    expect(transcribe.inputs).toHaveLength(0)
    expect(onError).toHaveBeenCalledExactlyOnceWith('notSaved')
    expect(capture.released).toBe(1)
  })

  test.each([
    ['a forced finish the meter heard only silence in', SILENCE_RMS / 2, 2500],
    ['a forced finish of a misclick, however loud', SILENCE_RMS * 20, MIN_RECORDING_MS - 1],
  ])('%s stays silent', async (_name, level, durationMs) => {
    const { actor, toRecording, capture, transcribe, onError, phase } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level, elapsedSeconds: 1 })
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(STOP_LIMIT_MS)
    capture.report({ type: 'recording.finished', audio: new Blob([]), durationMs, meterTrusted: true })
    expect(phase()).toBe('idle')
    expect(transcribe.inputs).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })

  test('a recorder that reports its own stop with nothing stays silent, speech heard or not', async () => {
    const { actor, toRecording, capture, onError, phase } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: SILENCE_RMS * 20, elapsedSeconds: 1 })
    actor.send({ type: 'toggle' })
    capture.report({ type: 'recording.finished', audio: new Blob([]), durationMs: 2500, meterTrusted: true })
    expect(phase()).toBe('idle')
    expect(onError).not.toHaveBeenCalled()
  })

  test('heardSpeech needs both a voice and a recording long enough to hold one', () => {
    expect(heardSpeech(MIN_RECORDING_MS, SILENCE_RMS)).toBe(true)
    expect(heardSpeech(MIN_RECORDING_MS - 1, 1)).toBe(false)
    expect(heardSpeech(5000, SILENCE_RMS / 2)).toBe(false)
    expect(heardSpeech(5000, 0)).toBe(false)
  })

  test('a silent recorder that captured nothing is dropped without a word', async () => {
    const { actor, toRecording, capture, transcribe, onError, phase } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    vi.advanceTimersByTime(STOP_LIMIT_MS)
    capture.report({ type: 'recording.finished', audio: new Blob([]), durationMs: 2500, meterTrusted: false })
    expect(phase()).toBe('idle')
    expect(transcribe.inputs).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expect(capture.released).toBe(1)
  })

  test('a recorder that reports in time is not asked again', async () => {
    const { actor, toRecording, capture } = harness()
    await toRecording()
    actor.send({ type: 'toggle' })
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 1500, meterTrusted: false })
    vi.advanceTimersByTime(STOP_LIMIT_MS * 2)
    expect(capture.commands).toEqual([{ type: 'stop' }])
  })

  test('the recording limit also bounds the stop it asks for', async () => {
    const { toRecording, capture } = harness()
    await toRecording()
    vi.advanceTimersByTime(MAX_DICTATION_SECONDS * 1000 + STOP_LIMIT_MS)
    expect(capture.commands).toEqual([{ type: 'stop' }, { type: 'finish' }])
  })

  test('a recorder that stops on its own, without a toggle, still finishes', async () => {
    const { toRecording, capture, phase } = harness()
    await toRecording()
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 2000, meterTrusted: false })
    expect(phase()).toBe('transcribing')
  })

  test('speech is sent with the format, and the capture is released', async () => {
    const { actor, toRecording, capture, transcribe, phase } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: 0.2, elapsedSeconds: 1 })
    actor.send({ type: 'toggle' })
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 1500, meterTrusted: true })
    expect(phase()).toBe('transcribing')
    expect(transcribe.inputs).toEqual([{ audio: AUDIO, format: 'webm', durationMs: 1500 }])
    expect(capture.released).toBe(1)
  })

  test.each([
    ['a trusted meter that heard nothing', { audio: AUDIO, durationMs: 3000, meterTrusted: true }],
    ['a press shorter than an utterance', { audio: AUDIO, durationMs: MIN_RECORDING_MS - 1, meterTrusted: false }],
    ['an empty recording', { audio: new Blob([]), durationMs: 3000, meterTrusted: false }],
  ])('%s returns to idle, sends nothing and says nothing', async (_name, finished) => {
    const { toRecording, capture, transcribe, onError, onTranscript, phase } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: SILENCE_RMS / 2, elapsedSeconds: 1 })
    capture.report({ type: 'recording.finished', ...finished })
    expect(phase()).toBe('idle')
    expect(transcribe.inputs).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(capture.released).toBe(1)
  })

  test('the next recording starts from a flat wave and no peak', async () => {
    const { actor, toRecording, capture } = harness()
    await toRecording()
    capture.report({ type: 'level.sampled', level: 0.2, elapsedSeconds: 4 })
    capture.report({ type: 'recording.finished', audio: new Blob([]), durationMs: 3000, meterTrusted: false })
    actor.send({ type: 'toggle' })
    capture.report({ type: 'microphone.opened' })
    expect(actor.getSnapshot().context).toMatchObject({ peak: 0, elapsedSeconds: 0 })
    expect(capture.inputs).toHaveLength(2)
  })
})

describe('transcribing', () => {
  test('no event moves it', async () => {
    const { actor, toTranscribing, phase, capture, transcribe } = harness()
    await toTranscribing()
    for (const event of EVERY_EVENT) actor.send(event)
    expect(phase()).toBe('transcribing')
    expect(capture.inputs).toHaveLength(1)
    expect(transcribe.inputs).toHaveLength(1)
  })

  test('text returns to idle and is handed over', async () => {
    const { toTranscribing, transcription, settle, phase, onTranscript, onError } = harness()
    await toTranscribing()
    transcription.resolve({ ok: true, text: 'Check the stairwell.' })
    await settle()
    expect(phase()).toBe('idle')
    expect(onTranscript.mock.calls).toEqual([['Check the stairwell.']])
    expect(onError).not.toHaveBeenCalled()
  })

  test('a refusal returns to idle with its reason', async () => {
    const { toTranscribing, transcription, settle, phase, onTranscript, onError } = harness()
    await toTranscribing()
    transcription.resolve({ ok: false, reason: 'rateLimited' })
    await settle()
    expect(phase()).toBe('idle')
    expect(onError.mock.calls).toEqual([['rateLimited']])
    expect(onTranscript).not.toHaveBeenCalled()
  })

  test('a request that throws is a failed dictation', async () => {
    const { toTranscribing, transcription, settle, phase, onError } = harness()
    await toTranscribing()
    transcription.reject(new Error('offline'))
    await settle()
    expect(phase()).toBe('idle')
    expect(onError.mock.calls).toEqual([['failed']])
  })
})

describe('stopping the machine', () => {
  test('while starting, releases the capture and reports nothing later', async () => {
    const { actor, toStarting, capture, onError } = harness()
    await toStarting()
    actor.stop()
    expect(capture.released).toBe(1)
    capture.report({ type: 'microphone.failed', key: 'denied' })
    vi.advanceTimersByTime(MICROPHONE_ANSWER_LIMIT_MS)
    expect(onError).not.toHaveBeenCalled()
  })

  test('while recording, releases the capture and sends nothing', async () => {
    const { actor, toRecording, capture, transcribe } = harness()
    await toRecording()
    actor.stop()
    expect(capture.released).toBe(1)
    capture.report({ type: 'recording.finished', audio: AUDIO, durationMs: 2000, meterTrusted: false })
    vi.advanceTimersByTime(MAX_DICTATION_SECONDS * 1000)
    expect(transcribe.inputs).toHaveLength(0)
    expect(capture.commands).toHaveLength(0)
  })

  test('while transcribing, aborts the request and drops its answer', async () => {
    const { actor, toTranscribing, transcription, transcribe, settle, onTranscript, onError } = harness()
    await toTranscribing()
    expect(transcribe.signal?.aborted).toBe(false)
    actor.stop()
    expect(transcribe.signal?.aborted).toBe(true)
    transcription.resolve({ ok: true, text: 'Too late.' })
    await settle()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('the silence gate', () => {
  test('a short press never held speech, whatever the meter says', () => {
    expect(heldSpeech(MIN_RECORDING_MS - 1, 1, true)).toBe(false)
    expect(heldSpeech(MIN_RECORDING_MS - 1, 1, false)).toBe(false)
  })

  test('a trusted meter decides, an untrusted one proves nothing', () => {
    expect(heldSpeech(MIN_RECORDING_MS, SILENCE_RMS, true)).toBe(true)
    expect(heldSpeech(MIN_RECORDING_MS, SILENCE_RMS / 2, true)).toBe(false)
    expect(heldSpeech(MIN_RECORDING_MS, 0, false)).toBe(true)
  })
})
