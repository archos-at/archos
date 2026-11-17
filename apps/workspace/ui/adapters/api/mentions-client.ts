import type { AwaitingStateResponse, MentionCandidatesResponse } from '@/lib/mentions/types'
import { ApiRequestError } from './api-error'

export const getAwaitingState = async (conversationId: string): Promise<AwaitingStateResponse> => {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/awaiting`)
  if (!response.ok) throw new ApiRequestError(`Failed to load awaiting state: ${response.status}`, response.status)
  return (await response.json()) as AwaitingStateResponse
}

export const releaseMention = async (requestId: string): Promise<AwaitingStateResponse> => {
  const response = await fetch(`/api/mentions/${encodeURIComponent(requestId)}/release`, { method: 'POST' })
  if (!response.ok) throw new ApiRequestError(`Failed to release mention: ${response.status}`, response.status)
  return (await response.json()) as AwaitingStateResponse
}

export const getMentionCandidates = async (conversationId: string): Promise<MentionCandidatesResponse> => {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/mention-candidates`)
  if (!response.ok) throw new ApiRequestError(`Failed to load mention candidates: ${response.status}`, response.status)
  return (await response.json()) as MentionCandidatesResponse
}
