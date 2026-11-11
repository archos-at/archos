/**
 * The microphone button's lifecycle as one statechart: every phase the button
 * can show and every move between them, declared once.
 *
 * Pure: no React and no browser globals. What touches the browser (the support
 * and permission check, the microphone with its recorder and level ticker, the
 * transcription request) is an actor, and what reaches the composer is an
 * action; `use-dictation.ts` provides all of them and the spec provides fakes.
 * The placeholders declared here only carry the types.
 */

import { assertEvent, assign, fromCallback, fromPromise, sendTo, setup, type SnapshotFrom } from 'xstate'
import { MAX_DICTATION_SECONDS, type DictationAudioFormat } from '@/lib/dictation/contract'
import type { DictationFailure, DictationOutcome } from './client'
import type { DictationUnavailableReason, RecordingSupport } from './recording-support'

/** Below this peak RMS level (of 1.0) a recording held no speech. Speech into a laptop mic peaks well above 0.05. */
export const SILENCE_RMS = 0.01
/** A press-and-release this short is a misclick, not an utterance. */
export const MIN_RECORDING_MS = 400
/** How many recent levels the waveform shows. */
export const WAVE_BARS = 14
/** The RMS a raised voice reaches; the waveform's full height. */
const WAVE_FULL_RMS = 0.25

/** A raw RMS reading as a bar height from 0 to 1. Square-rooted, so quiet speech still moves the bars. */
export function waveHeight(rms: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, rms) / WAVE_FULL_RMS))
}

const SILENT_WAVE: readonly number[] = Array.from({ length: WAVE_BARS }, () => 0)

/** Whether a finished recording held speech worth sending. */
export function heldSpeech(durationMs: number, peak: number, meterTrusted: boolean): boolean {
  if (durationMs < MIN_RECORDING_MS) return false
  // A meter that never ran (no Web Audio, a suspended context) proves nothing: send.
  return !meterTrusted || peak >= SILENCE_RMS
}

export type DictationErrorKey = DictationFailure | 'noMicrophone' | 'denied'

/** What the button renders: the machine's state, flattened to one phase. */
export type DictationState =
  | { phase: 'checking' }
  | { phase: 'unavailable'; reason: DictationUnavailableReason }
  | { phase: 'idle' }
  | { phase: 'starting' }
  | {
      phase: 'recording'
      elapsedSeconds: number
      /** The last {@link WAVE_BARS} levels, 0 to 1, oldest first: the live waveform. */
      levels: readonly number[]
    }
  | { phase: 'transcribing' }

type AvailableRecordingSupport = Extract<RecordingSupport, { available: true }>

export interface DictationContext {
  /** The container this browser records, known once the check passed. */
  support: AvailableRecordingSupport | null
  unavailableReason: DictationUnavailableReason | null
  elapsedSeconds: number
  levels: readonly number[]
  /** The loudest raw level of the current recording: the silence gate's evidence. */
  peak: number
}

/** What the capture actor reports back while it holds the microphone. */
export type CaptureEvent =
  | { type: 'microphone.opened' }
  | { type: 'microphone.failed'; key: DictationErrorKey }
  | { type: 'level.sampled'; level: number; elapsedSeconds: number }
  | { type: 'recording.finished'; audio: Blob; durationMs: number; meterTrusted: boolean }

export type DictationEvent = { type: 'toggle' } | CaptureEvent

/** The one thing the machine asks of the capture actor; the recorder answers with `recording.finished`. */
export interface CaptureCommand {
  type: 'stop'
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
  // Only `idle` leads here, and only a passed check leads to `idle`.
  if (!context.support) throw new Error('Dictation started before its support check passed.')
  return context.support
}

export const dictationMachine = setup({
  types: {
    context: {} as DictationContext,
    events: {} as DictationEvent,
  },
  actors: {
    /** Resolves what this browser can record, with an already denied permission as `unavailable`. */
    checkSupport: fromPromise<RecordingSupport>(async () => ({ available: false, reason: 'unsupported' })),
    /** Opens the microphone, records and samples the level until stopped; releases everything when it ends. */
    capture: fromCallback<CaptureCommand, CaptureInput>(() => {}),
    /** Sends one recording. Resolves with the outcome and aborts its request when stopped. */
    transcribe: fromPromise<DictationOutcome, TranscriptionInput>(async () => ({ ok: false, reason: 'failed' })),
  },
  actions: {
    notifyTranscript: (_, _params: { text: string }) => {},
    notifyError: (_, _params: { key: DictationErrorKey }) => {},
  },
  delays: {
    recordingLimit: MAX_DICTATION_SECONDS * 1000,
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
        // The provided check never rejects. A check that does cannot be trusted to record either.
        onError: { target: 'unavailable', actions: assign({ unavailableReason: 'unsupported' }) },
      },
    },
    // Not final: the button stays mounted and keeps showing why, until the page reloads.
    unavailable: {},
    idle: {
      on: { toggle: 'capturing' },
    },
    capturing: {
      entry: assign({ elapsedSeconds: 0, levels: SILENT_WAVE, peak: 0 }),
      // One actor for both sub-states: the stream it opens while starting is the one it records.
      invoke: {
        id: 'capture',
        src: 'capture',
        input: ({ context }) => ({ mimeType: supportOf(context).mimeType }),
      },
      initial: 'starting',
      states: {
        starting: {
          on: {
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
              // Silence or a misclick: nothing is sent and nothing is said.
              { target: '#dictation.idle' },
            ],
          },
          initial: 'live',
          states: {
            live: {
              on: { toggle: 'stopping' },
              after: { recordingLimit: 'stopping' },
            },
            // The recorder flushes its last chunk before it reports; a second press here has nothing to stop.
            stopping: {
              entry: sendTo('capture', { type: 'stop' }),
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
        // The provided request never rejects. One that does is a failed dictation like any other.
        onError: { target: 'idle', actions: { type: 'notifyError', params: { key: 'failed' } } },
      },
    },
  },
})

export type DictationSnapshot = SnapshotFrom<typeof dictationMachine>

/** The phase the button renders for a snapshot. */
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
