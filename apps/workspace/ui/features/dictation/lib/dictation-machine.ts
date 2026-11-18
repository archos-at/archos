import { assertEvent, assign, fromCallback, fromPromise, sendTo, setup, type SnapshotFrom } from 'xstate'
import { MAX_DICTATION_SECONDS, type DictationAudioFormat } from '@/lib/dictation/contract'
import type { DictationFailure, DictationOutcome } from './client'
import type { DictationUnavailableReason, RecordingSupport } from './recording-support'

export const SILENCE_RMS = 0.01
export const MIN_RECORDING_MS = 400
export const MICROPHONE_ANSWER_LIMIT_MS = 120_000
export const STOP_LIMIT_MS = 2_000
export const WAVE_BARS = 14
const WAVE_FULL_RMS = 0.25

export function waveHeight(rms: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, rms) / WAVE_FULL_RMS))
}

const SILENT_WAVE: readonly number[] = Array.from({ length: WAVE_BARS }, () => 0)

export function heldSpeech(durationMs: number, peak: number, meterTrusted: boolean): boolean {
  if (durationMs < MIN_RECORDING_MS) return false
  return !meterTrusted || peak >= SILENCE_RMS
}

export function heardSpeech(durationMs: number, peak: number): boolean {
  return durationMs >= MIN_RECORDING_MS && peak >= SILENCE_RMS
}

export type DictationErrorKey = DictationFailure | 'noMicrophone' | 'denied' | 'noAnswer' | 'notSaved'

export type DictationState =
  | { phase: 'checking' }
  | { phase: 'unavailable'; reason: DictationUnavailableReason }
  | { phase: 'idle' }
  | { phase: 'starting' }
  | {
      phase: 'recording'
      elapsedSeconds: number
      levels: readonly number[]
    }
  | { phase: 'transcribing' }

type AvailableRecordingSupport = Extract<RecordingSupport, { available: true }>

export interface DictationContext {
  support: AvailableRecordingSupport | null
  unavailableReason: DictationUnavailableReason | null
  elapsedSeconds: number
  levels: readonly number[]
  peak: number
}

export type CaptureEvent =
  | { type: 'microphone.opened' }
  | { type: 'microphone.failed'; key: DictationErrorKey }
  | { type: 'level.sampled'; level: number; elapsedSeconds: number }
  | { type: 'recording.finished'; audio: Blob; durationMs: number; meterTrusted: boolean }

export type DictationEvent = { type: 'toggle' } | CaptureEvent

export interface CaptureCommand {
  type: 'stop' | 'finish'
}

export interface CaptureInput {
  mimeType: string
}

export interface TranscriptionInput {
  audio: Blob
  format: DictationAudioFormat
  durationMs: number
}

function supportOf(context: DictationContext): AvailableRecordingSupport {
  if (!context.support) throw new Error('Dictation started before its support check passed.')
  return context.support
}

export const dictationMachine = setup({
  types: {
    context: {} as DictationContext,
    events: {} as DictationEvent,
  },
  actors: {
    checkSupport: fromPromise<RecordingSupport>(async () => ({ available: false, reason: 'unsupported' })),
    capture: fromCallback<CaptureCommand, CaptureInput>(() => {}),
    transcribe: fromPromise<DictationOutcome, TranscriptionInput>(async () => ({ ok: false, reason: 'failed' })),
  },
  actions: {
    notifyTranscript: (_, _params: { text: string }) => {},
    notifyError: (_, _params: { key: DictationErrorKey }) => {},
  },
  delays: {
    recordingLimit: MAX_DICTATION_SECONDS * 1000,
    microphoneAnswerLimit: MICROPHONE_ANSWER_LIMIT_MS,
    stopLimit: STOP_LIMIT_MS,
  },
}).createMachine({
  id: 'dictation',
  context: { support: null, unavailableReason: null, elapsedSeconds: 0, levels: SILENT_WAVE, peak: 0 },
  initial: 'checking',
  states: {
    checking: {
      invoke: {
        src: 'checkSupport',
        onDone: [
          {
            guard: ({ event }) => event.output.available,
            target: 'idle',
            actions: assign({ support: ({ event }) => (event.output.available ? event.output : null) }),
          },
          {
            target: 'unavailable',
            actions: assign({
              unavailableReason: ({ event }) => (event.output.available ? null : event.output.reason),
            }),
          },
        ],
        onError: { target: 'unavailable', actions: assign({ unavailableReason: 'unsupported' }) },
      },
    },
    unavailable: {},
    idle: {
      on: { toggle: 'capturing' },
    },
    capturing: {
      entry: assign({ elapsedSeconds: 0, levels: SILENT_WAVE, peak: 0 }),
      invoke: {
        id: 'capture',
        src: 'capture',
        input: ({ context }) => ({ mimeType: supportOf(context).mimeType }),
      },
      initial: 'starting',
      states: {
        starting: {
          on: {
            toggle: '#dictation.idle',
            'microphone.opened': 'recording',
            'microphone.failed': [
              {
                guard: ({ event }) => event.key === 'denied',
                target: '#dictation.unavailable',
                actions: [
                  assign({ unavailableReason: 'denied' }),
                  { type: 'notifyError', params: ({ event }) => ({ key: event.key }) },
                ],
              },
              {
                target: '#dictation.idle',
                actions: { type: 'notifyError', params: ({ event }) => ({ key: event.key }) },
              },
            ],
          },
          after: {
            microphoneAnswerLimit: {
              target: '#dictation.idle',
              actions: { type: 'notifyError', params: { key: 'noAnswer' } },
            },
          },
        },
        recording: {
          on: {
            'level.sampled': {
              actions: assign({
                elapsedSeconds: ({ event }) => event.elapsedSeconds,
                levels: ({ context, event }) => [...context.levels.slice(1), waveHeight(event.level)],
                peak: ({ context, event }) => Math.max(context.peak, event.level),
              }),
            },
            'recording.finished': [
              {
                guard: ({ context, event }) =>
                  event.audio.size > 0 && heldSpeech(event.durationMs, context.peak, event.meterTrusted),
                target: '#dictation.transcribing',
              },
              { target: '#dictation.idle' },
            ],
          },
          initial: 'live',
          states: {
            live: {
              on: { toggle: 'stopping' },
              after: { recordingLimit: 'stopping' },
            },
            stopping: {
              entry: sendTo('capture', { type: 'stop' }),
              after: { stopLimit: 'forced' },
            },
            forced: {
              entry: sendTo('capture', { type: 'finish' }),
              on: {
                'recording.finished': [
                  {
                    guard: ({ context, event }) =>
                      event.audio.size > 0 && heldSpeech(event.durationMs, context.peak, event.meterTrusted),
                    target: '#dictation.transcribing',
                  },
                  {
                    guard: ({ context, event }) => event.audio.size === 0 && heardSpeech(event.durationMs, context.peak),
                    target: '#dictation.idle',
                    actions: { type: 'notifyError', params: { key: 'notSaved' } },
                  },
                  { target: '#dictation.idle' },
                ],
              },
            },
          },
        },
      },
    },
    transcribing: {
      invoke: {
        src: 'transcribe',
        input: ({ context, event }) => {
          assertEvent(event, 'recording.finished')
          return { audio: event.audio, format: supportOf(context).format, durationMs: event.durationMs }
        },
        onDone: [
          {
            guard: ({ event }) => event.output.ok,
            target: 'idle',
            actions: {
              type: 'notifyTranscript',
              params: ({ event }) => ({ text: event.output.ok ? event.output.text : '' }),
            },
          },
          {
            target: 'idle',
            actions: {
              type: 'notifyError',
              params: ({ event }) => ({ key: event.output.ok ? 'failed' : event.output.reason }),
            },
          },
        ],
        onError: { target: 'idle', actions: { type: 'notifyError', params: { key: 'failed' } } },
      },
    },
  },
})

export type DictationSnapshot = SnapshotFrom<typeof dictationMachine>

export function dictationStateOf(snapshot: DictationSnapshot): DictationState {
  const { context } = snapshot
  if (snapshot.matches('checking')) return { phase: 'checking' }
  if (snapshot.matches('unavailable')) return { phase: 'unavailable', reason: context.unavailableReason ?? 'unsupported' }
  if (snapshot.matches({ capturing: 'starting' })) return { phase: 'starting' }
  if (snapshot.matches({ capturing: 'recording' })) {
    return { phase: 'recording', elapsedSeconds: context.elapsedSeconds, levels: context.levels }
  }
  if (snapshot.matches('transcribing')) return { phase: 'transcribing' }
  return { phase: 'idle' }
}
