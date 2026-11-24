import { z } from 'zod'
import { SCALE_STATES } from '@/lib/annotations/measure-shapes'

export const SCALE_SOURCES = ['calibration', 'stored_region', 'scale_note', 'none'] as const

const share = z.number().min(0).max(1)
const flatPairs = (per: number) =>
  z.array(share).refine((values) => values.length % per === 0, `a multiple of ${per} shares`)

export const snapScaleSchema = z.object({
  region: z.tuple([share, share, share, share]).nullable(),
  state: z.enum(SCALE_STATES),
  source: z.enum(SCALE_SOURCES),
  metresPerShare: z.tuple([z.number().positive(), z.number().positive()]).nullable(),
  ratio: z.number().positive().nullable(),
})
export type SnapScale = z.infer<typeof snapScaleSchema>

export const snapTargetsSchema = z.object({
  documentId: z.string().nullable(),
  versionId: z.string().nullable(),
  page: z.number().int().min(1),
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  rotation: z.number().int(),
  scan: z.boolean(),
  vertices: flatPairs(2),
  segments: flatPairs(4),
  totalSegments: z.number().int().min(0),
  truncated: z.boolean(),
  scales: z.array(snapScaleSchema),
})
export type SnapTargets = z.infer<typeof snapTargetsSchema>

export const snapTargetsResponseSchema = z.union([
  z.object({ targets: snapTargetsSchema }),
  z.object({ unavailable: z.object({ reason: z.string() }) }),
])
export type SnapTargetsResponse = z.infer<typeof snapTargetsResponseSchema>

export const snapTargetsQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(100_000) })
  .strict()

export const snapTargetsPath = (documentId: string, page: number) =>
  `/api/documents/${encodeURIComponent(documentId)}/snap-targets?page=${page}`

export type SnapTargetsFetch = (path: string, init?: RequestInit) => Promise<Response>

export class SnapTargetsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SnapTargetsRequestError'
  }
}

export async function fetchSnapTargets(
  documentId: string,
  page: number,
  run: SnapTargetsFetch = (path, init) => fetch(path, init)
): Promise<SnapTargets> {
  const response = await run(snapTargetsPath(documentId, page), { method: 'GET' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string }
    throw new SnapTargetsRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`
    )
  }
  const answer = snapTargetsResponseSchema.parse(body)
  if ('unavailable' in answer)
    throw new SnapTargetsRequestError(422, 'UNAVAILABLE', answer.unavailable.reason)
  return answer.targets
}
