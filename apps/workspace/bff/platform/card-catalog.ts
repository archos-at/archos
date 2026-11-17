import 'server-only'
import { z } from 'zod'
import { getBackendUrl } from '@/lib/backend-proxy'
import { UpstreamError } from '@/lib/api/errors'

const CATALOG_TIMEOUT_MS = 10_000

const cardFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
  constraints: z.array(z.string()),
})

const cardSchema = z.object({
  type: z.string(),
  model: z.string(),
  summary: z.string(),
  emittedBy: z.enum(['agent', 'system']),
  interaction: z.enum(['presentational', 'interactive']),
  fields: z.array(cardFieldSchema),
  example: z.unknown().nullable(),
})

export const cardCatalogSchema = z.object({
  cards: z.array(cardSchema),
  buildingBlocks: z.record(z.string(), z.array(cardFieldSchema)),
  cardCount: z.number(),
  featureRequest: z.object({
    repository: z.string(),
    url: z.string(),
    label: z.string(),
  }),
})

export type CardCatalog = z.infer<typeof cardCatalogSchema>
export type CardCatalogEntry = z.infer<typeof cardSchema>

export async function getCardCatalog(): Promise<CardCatalog> {
  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/platform/cards`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError(
      'Card catalog backend unreachable',
      error instanceof Error ? error.message : undefined
    )
  }
  if (!response.ok) {
    throw new UpstreamError(`Card catalog backend returned ${response.status}`)
  }
  const body = await response.json().catch(() => {
    throw new UpstreamError('Card catalog backend returned malformed JSON')
  })
  const parsed = cardCatalogSchema.safeParse(body)
  if (!parsed.success) {
    throw new UpstreamError('Card catalog backend returned an unexpected shape')
  }
  return parsed.data
}
