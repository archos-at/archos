export type SpanKind = 'turn' | 'node' | 'llm' | 'tool'
export type SpanStatus = 'ok' | 'error'

export interface ConversationSummaryDto {
  conversationId: string
  organizationId: string | null
  organizationName?: string | null
  title: string | null
  titleWithheld?: boolean
  turnCount: number
  totalDurationMs: number
  lastActiveAt: string
}

export interface SpanNodeDto {
  spanId: string
  kind: SpanKind
  name: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: SpanStatus
  errorMessage: string | null
  metadata?: Record<string, unknown> | null
  children: SpanNodeDto[]
}

export interface TurnDto {
  turnId: string
  jobId: string | null
  startedAt: string
  durationMs: number
  status: SpanStatus
  spanCount: number
  root: SpanNodeDto | null
}

export interface TimelineDto {
  conversationId: string
  turns: TurnDto[]
  totalTurns?: number
  capped?: boolean
}

export interface ConversationListDto {
  conversations: ConversationSummaryDto[]
  capped: boolean
  selected?: ConversationSummaryDto | null
}
