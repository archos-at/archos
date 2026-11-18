import {
  fetchOfficeFeedback,
  fetchOwnFeedback,
  fetchOwnFeedbackThread,
  replyToOwnFeedback,
  submitProductFeedback,
  type ReplyToFeedbackResult,
  type SubmitProductFeedbackRequest,
  type SubmitProductFeedbackResult,
} from '@/lib/product-feedback/client'
import type { OwnProductFeedbackListResponse, OwnProductFeedbackThread } from '@/lib/product-feedback/types'

export type FeedbackScope = 'mine' | 'office'

export type Load<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: T }

export interface FeedbackThreadsApi {
  list: (cursor?: string) => Promise<OwnProductFeedbackListResponse>
  office: (cursor?: string) => Promise<OwnProductFeedbackListResponse>
  thread: (id: string) => Promise<OwnProductFeedbackThread>
  reply: (id: string, message: string) => Promise<ReplyToFeedbackResult>
  submit: (request: SubmitProductFeedbackRequest) => Promise<SubmitProductFeedbackResult>
}

export const LIVE_API: FeedbackThreadsApi = {
  list: fetchOwnFeedback,
  office: fetchOfficeFeedback,
  thread: fetchOwnFeedbackThread,
  reply: replyToOwnFeedback,
  submit: submitProductFeedback,
}
