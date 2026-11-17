import type { FeedbackFilterOptions } from '@/lib/feedback/export-service'
import { ApiRequestError } from './api-error'

export type { FeedbackFilterOptions }

export interface FeedbackDigestPayload {
  headline: string
  strengths: string[]
  concerns: string[]
  recommendation: string | null
  generatedAt: string
  windowDays: number
  votes: number
  causes?: { cause: string; count: number }[]
}

export interface AnswerFeedbackDigestResponse {
  digest: FeedbackDigestPayload | null
  error: string | null
}

export const getAnswerFeedbackDigest = async (query: string): Promise<AnswerFeedbackDigestResponse> => {
  const response = await fetch(`/api/platform/answer-feedback/digest?${query}`)
  if (!response.ok) {
    throw new ApiRequestError(`Failed to load answer feedback digest: ${response.status}`, response.status)
  }
  return (await response.json()) as AnswerFeedbackDigestResponse
}

export const getAnswerFeedbackFilterOptions = async (
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<FeedbackFilterOptions> => {
  const response = await fetch(`/api/platform/answer-feedback/options?${query}`, { signal: options.signal })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to load answer feedback options: ${response.status}`, response.status)
  }
  return (await response.json()) as FeedbackFilterOptions
}
