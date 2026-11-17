import 'server-only'
import {
  BadRequestError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UpstreamError,
} from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBackendUrl } from '@/lib/backend-proxy'
import { internalServiceHeaders } from '@/lib/internal-auth'
import {
  MAX_DICTATION_AUDIO_BYTES,
  dictationFormatOf,
  type DictationResult,
} from './contract'

const MAX_REPORTED_DURATION_MS = 120_000

const BACKEND_TIMEOUT_MS = 60_000

export interface DictationInput {
  audio: Blob
  durationMs: number | null
  locale: string | null
}

interface BackendDictationResponse {
  text?: string
  error?: string | null
}

function toApiError(code: string): Error {
  switch (code) {
    case 'audio_too_large':
      return new PayloadTooLargeError(MAX_DICTATION_AUDIO_BYTES)
    case 'audio_invalid':
      return new BadRequestError('The recording could not be read.')
    case 'transcription_not_configured':
      return new ServiceUnavailableError('Voice input is not configured.')
    default:
      return new UpstreamError('The recording could not be transcribed.')
  }
}

function checkedFormat(audio: Blob): string {
  if (audio.size === 0) throw new BadRequestError('The recording is empty.')
  if (audio.size > MAX_DICTATION_AUDIO_BYTES) throw new PayloadTooLargeError(MAX_DICTATION_AUDIO_BYTES)
  const format = dictationFormatOf(audio.type)
  if (!format) throw new BadRequestError('Unsupported audio format.')
  return format
}

async function postToBackend(session: AuthorizedSession, body: object): Promise<Response> {
  const backendUrl = getBackendUrl()
  const serviceHeaders = internalServiceHeaders(backendUrl)
  try {
    return await fetch(`${backendUrl}/v1/dictation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...serviceHeaders,
        'x-organization-id': session.organizationId,
        'x-user-id': session.userId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
  } catch (error) {
    console.warn('[Dictation] Backend unreachable or timed out:', error)
    throw new UpstreamError('The recording could not be transcribed.')
  }
}

export async function transcribeDictation(
  session: AuthorizedSession,
  input: DictationInput,
): Promise<DictationResult> {
  const format = checkedFormat(input.audio)
  const audioBase64 = Buffer.from(await input.audio.arrayBuffer()).toString('base64')
  const durationMs =
    input.durationMs === null ? null : Math.min(Math.max(Math.round(input.durationMs), 0), MAX_REPORTED_DURATION_MS)

  const response = await postToBackend(session, {
    audio_base64: audioBase64,
    format,
    duration_ms: durationMs,
    locale: input.locale,
  })
  if (!response.ok) {
    console.error('[Dictation] Backend error:', response.status, await response.text().catch(() => ''))
    throw new UpstreamError('The recording could not be transcribed.')
  }

  const data = (await response.json()) as BackendDictationResponse
  if (data.error) {
    console.warn('[Dictation] Transcription degraded:', data.error)
    throw toApiError(data.error)
  }
  return { text: typeof data.text === 'string' ? data.text : '' }
}
