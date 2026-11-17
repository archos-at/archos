import type { Translator } from '@/i18n'

export const MODEL_REJECTION_CODES = [
  'unknown_group',
  'not_in_catalog',
  'not_zdr',
  'zdr_endpoint_lacks_capability',
  'no_text_input',
  'no_image_input',
  'context_too_small',
  'missing_parameter',
  'reasoning_mandatory',
] as const

export type ModelRejectionCode = (typeof MODEL_REJECTION_CODES)[number]

export interface ModelRejection {
  code: ModelRejectionCode
  message: string
  params?: Record<string, string | number>
}

export const ZDR_LIST_UNAVAILABLE = 'zdr_list_unavailable'

export async function isZdrListUnavailableResponse(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    const body = (await res.json()) as { details?: { reason?: unknown } }
    return body.details?.reason === ZDR_LIST_UNAVAILABLE
  } catch {
    return false
  }
}

export function isModelRejectionCode(value: unknown): value is ModelRejectionCode {
  return typeof value === 'string' && (MODEL_REJECTION_CODES as readonly string[]).includes(value)
}

function isModelRejection(value: unknown): value is ModelRejection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ModelRejection>
  return isModelRejectionCode(candidate.code) && typeof candidate.message === 'string'
}

export function readRejectionDetails(details: unknown): Record<string, ModelRejection[]> {
  if (!details || typeof details !== 'object') return {}
  const out: Record<string, ModelRejection[]> = {}
  for (const [group, value] of Object.entries(details as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const rejections = value.filter(isModelRejection)
    if (rejections.length > 0) out[group] = rejections
  }
  return out
}

export function localizeRejection(rejection: ModelRejection, t: Translator): string {
  return t(`models.rejection.${rejection.code}`, rejection.params)
}

export function describeRejections(
  details: unknown,
  t: Translator,
  labelOf: (groupId: string) => string
): string[] {
  return Object.entries(readRejectionDetails(details)).map(
    ([group, rejections]) =>
      `${labelOf(group)}: ${rejections.map((rejection) => localizeRejection(rejection, t)).join('; ')}`
  )
}
