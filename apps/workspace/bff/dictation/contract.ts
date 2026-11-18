export const MAX_DICTATION_SECONDS = 45

export const MAX_DICTATION_AUDIO_BYTES = 4 * 1024 * 1024

export const DICTATION_AUDIO_BITS_PER_SECOND = 64_000

export type DictationAudioFormat = 'webm' | 'ogg' | 'm4a'

export const DICTATION_RECORDING_TYPES: ReadonlyArray<{ mimeType: string; format: DictationAudioFormat }> = [
  { mimeType: 'audio/webm;codecs=opus', format: 'webm' },
  { mimeType: 'audio/webm', format: 'webm' },
  { mimeType: 'audio/mp4', format: 'm4a' },
  { mimeType: 'audio/ogg;codecs=opus', format: 'ogg' },
]

export function dictationFormatOf(mimeType: string): DictationAudioFormat | null {
  const base = mimeType.split(';')[0]?.trim().toLowerCase()
  if (base === 'audio/webm' || base === 'video/webm') return 'webm'
  if (base === 'audio/mp4' || base === 'video/mp4' || base === 'audio/x-m4a' || base === 'audio/aac') return 'm4a'
  if (base === 'audio/ogg') return 'ogg'
  return null
}

export interface DictationResult {
  text: string
}
