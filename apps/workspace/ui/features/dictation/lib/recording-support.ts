/**
 * Whether this browser can dictate, and in which container. Decided once, from
 * what the browser offers, so the button can be disabled and say why before
 * anyone presses it.
 */

import { DICTATION_RECORDING_TYPES, type DictationAudioFormat } from '@/lib/dictation/contract'

/** Why the microphone button is disabled; each has its own hover text. */
export type DictationUnavailableReason = 'unsupported' | 'insecure' | 'noFormat' | 'denied'

export type RecordingSupport =
  | { available: true; mimeType: string; format: DictationAudioFormat }
  | { available: false; reason: DictationUnavailableReason }

/** The slice of `window` the decision reads; injectable for tests. */
export interface RecordingEnvironment {
  isSecureContext?: boolean
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
  MediaRecorder?: { isTypeSupported?: (mimeType: string) => boolean }
}

export function detectRecordingSupport(env: RecordingEnvironment | undefined): RecordingSupport {
  if (!env) return { available: false, reason: 'unsupported' }
  // Browsers hide `mediaDevices` entirely outside a secure context, so say
  // which of the two it is: one is fixed by the deployment, not the browser.
  if (env.isSecureContext === false) return { available: false, reason: 'insecure' }
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== 'function' || !env.MediaRecorder) {
    return { available: false, reason: 'unsupported' }
  }
  const isTypeSupported = env.MediaRecorder.isTypeSupported
  if (typeof isTypeSupported !== 'function') return { available: false, reason: 'noFormat' }
  const match = DICTATION_RECORDING_TYPES.find(({ mimeType }) => isTypeSupported.call(env.MediaRecorder, mimeType))
  return match ? { available: true, ...match } : { available: false, reason: 'noFormat' }
}

/** How long the permission query may take. It reads a stored setting, so a browser that answers at all answers at once. */
export const PERMISSION_QUERY_LIMIT_MS = 1_000

/**
 * Whether the microphone permission is already denied, without prompting.
 * `false` when the browser cannot say (Firefox has no `microphone` permission
 * name) or does not answer within `limitMs`: the prompt on first press is then
 * what tells us, and a button that waited for the answer would stay disabled.
 */
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
