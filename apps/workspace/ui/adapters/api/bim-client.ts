import type { BimComparison } from '@/lib/bim/compare'
import { ApiRequestError } from './api-error'

export type { BimComparison }

export interface CompareBimModelInput {
  baseModelId: string
  limit: number
}

export const compareBimModel = async (
  modelId: string,
  input: CompareBimModelInput,
): Promise<BimComparison | null> => {
  const response = await fetch(`/api/bim/models/${modelId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'compare', ...input }),
  })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to compare models: ${response.status}`, response.status)
  }
  const body = (await response.json()) as { comparison?: BimComparison }
  return body.comparison ?? null
}
