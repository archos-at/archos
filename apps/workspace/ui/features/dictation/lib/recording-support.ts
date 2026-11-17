import { DICTATION_RECORDING_TYPES, type DictationAudioFormat } from '@/lib/dictation/contract'

export type DictationUnavailableReason = 'unsupported' | 'insecure' | 'noFormat' | 'denied'

export type RecordingSupport =
  | { available: true; mimeType: string; format: DictationAudioFormat }
  | { available: false; reason: DictationUnavailableReason }

export interface RecordingEnvironment {
  isSecureContext?: boolean
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
  MediaRecorder?: { isTypeSupported?: (mimeType: string) => boolean }
}

export function detectRecordingSupport(env: RecordingEnvironment | undefined): RecordingSupport {
  if (!env) return { available: false, reason: 'unsupported' }
  if (env.isSecureContext === false) return { available: false, reason: 'insecure' }
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== 'function' || !env.MediaRecorder) {
    return { available: false, reason: 'unsupported' }
  }
  const isTypeSupported = env.MediaRecorder.isTypeSupported
  if (typeof isTypeSupported !== 'function') return { available: false, reason: 'noFormat' }
  const match = DICTATION_RECORDING_TYPES.find(({ mimeType }) => isTypeSupported.call(env.MediaRecorder, mimeType))
  return match ? { available: true, ...match } : { available: false, reason: 'noFormat' }
}

export const PERMISSION_QUERY_LIMIT_MS = 1_000

export async function isMicrophoneDenied(
  permissions: { query?: (descriptor: { name: PermissionName }) => Promise<{ state: string }> } | undefined,
  limitMs: number = PERMISSION_QUERY_LIMIT_MS,
): Promise<boolean> {
  if (typeof permissions?.query !== 'function') return false
  let timer: ReturnType<typeof setTimeout> | undefined
  const unanswered = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs)
  })
  try {
    const status = await Promise.race([permissions.query({ name: 'microphone' }), unanswered])
    return status?.state === 'denied'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
