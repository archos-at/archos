import type { PageRegion } from '@/features/knowledge/lib/page-region'
import type { AnswerCard } from '@/shared/cards/schemas'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { ProjectStatus } from '@/lib/projects/project-status'
import type {
  AnswerConfidenceCappedReason,
  StoredThinkingStep,
} from '@/lib/conversations/message-provenance'
import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import type { Findings } from '@/lib/conversations/message-findings'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import type { QuoteStamp } from '@/lib/conversations/message-quote-stamps'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import type { RunLedger } from '@/lib/runs/run-ledger-types'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { StoredPromptOption } from '@/lib/conversations/message-prompt'
import type { MessagesSlice } from './stores/messages-store'
import type { SessionsSlice } from './stores/sessions-store'
import type { InteractionSlice } from './stores/interaction-store'

import type { Shelf, SourceKind } from '@/lib/source-kinds'
import type { CitationLineWire } from '@/shared/citation-line'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'

export type { ComposerPrefill, ComposerSubject } from './composer-types'

export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageType =
  | 'user'
  | 'assistant'
  | 'status'
  | 'prompt'
  | 'agent_response'
  | 'file'
  | 'error'

export type FileUploadStatusType = 'uploaded' | 'pending_warning'

export type FileStatus = 'uploading' | 'ingesting' | 'success' | 'deleted' | 'error'

export type ErrorCode =
  | 'connection.lost'
  | 'connection.failed'
  | 'connection.timeout'
  | 'connection.client_outdated'
  | 'connection.server_incompatible'
  | 'auth.session_expired'
  | 'auth.unauthorized'
  | 'agent.response_failed'
  | 'agent.response_interrupted'
  | 'agent.no_response'
  | 'agent.workflow_error'
  | 'agent.zdr_refused'
  | 'research.queue_full'
  | 'budget.exhausted'
  | 'system.unknown'

export type RecoveryOutcome = 'recovered' | 'superseded' | 'nothing'

export interface ResumableTurn {
  conversationId: string
  turnId: string
}

export interface FileCardData {
  fileName: string
  fileSize?: number
  fileStatus: FileStatus
  progress?: number
  errorMessage?: string
}

export interface ErrorCardData {
  errorCode: ErrorCode
  errorMessage?: string
  errorDetails?: string
}

export interface FileUploadStatusData {
  type: FileUploadStatusType
  fileCount: number
  jobId: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  messageType?: MessageType
  isStreaming?: boolean
  promptId?: string
  promptParentId?: string
  promptInputType?: 'text' | 'choice'
  promptOptions?: StoredPromptOption[]
  promptPlaceholder?: string
  promptResponse?: string
  isPromptResponded?: boolean
  promptFor?: string
  fileData?: FileCardData
  errorData?: ErrorCardData
  fileUploadStatusData?: FileUploadStatusData

  thinkingSteps?: StoredThinkingStep[]
  citations?: CitationSource[]
  deepResearchJobId?: string
  enabledDataSources?: string[]
  messageFiles?: Array<{ id: string; fileName: string }>
  cards?: (AnswerCard | undefined)[]
  cardInteractions?: CardInteractions
  authorUserId?: string | null
  authorName?: string | null
  authorAvatarUrl?: string | null
  mentions?: Array<{ targetId: string; display: string }>
  addressees?: { agent: boolean; users: string[] }
  answerConfidence?: 'low' | 'medium' | 'high'
  answerConfidenceCappedReason?: AnswerConfidenceCappedReason
  answerConfidenceReason?: string
  routingDecision?: 'meta' | 'shallow' | 'deep' | 'error'
  escalationReason?: string
  answerDurationMs?: number
  reasoningEffort?: ChatEffort
  citationsRemoved?: { count: number; reasons: string[] }
  readSources?: CitationSource[]
  researchTruncated?: true
  truncationReason?: string
  degradedReasons?: string[]
  skillsActivated?: string[]
  skillsHidden?: string[]
  answerMeta?: AnswerMeta
  findings?: Findings
  retrievalLedger?: RetrievalLedger
  quoteStamps?: QuoteStamp[]
  confidenceCheck?: ConfidenceCheck
  answerConfidenceVersion?: 1 | 2
  lookupFoundNothing?: true
  runLedger?: RunLedger
  runTitle?: string
  stopped?: true
  sourceDeletedAt?: string
  erasedAt?: string
  failed?: true
  stages?: MessageStages
}

export interface Conversation {
  id: string
  userId: string
  projectId?: string | null
  jobId?: string | null
  title: string
  subjectResourceType?: 'document' | null
  subjectResourceId?: string | null
  messages: ChatMessage[]
  createdAt: Date
  updatedAt: Date
  contentLocked?: boolean
  temporary?: boolean
  enabledDataSourceIds?: string[]
}

export interface PendingInteraction {
  turnId: string
  interactionId: string
  input: 'text' | 'choice'
}

export interface CitationProject {
  id: string
  name: string
  status: ProjectStatus
  federalStateNote?: string | null
}

export interface CitationSource {
  id: string
  url?: string
  content: string
  timestamp: Date
  isCited?: boolean
  origin?: 'kb' | 'ris' | 'web'
  number?: number
  title?: string
  citationKey?: string
  collection?: string
  sourceType?: string
  tool?: string
  fileName?: string
  page?: number
  clause?: string
  score?: number
  snippet?: string
  kind?: SourceKind
  shelf?: Shelf
  documentId?: string
  lane?: string
  laneLabel?: string
  bindingNote?: string
  bindingStatus?: string
  regions?: PageRegion[]
  project?: CitationProject
  line?: CitationLineWire
}

export type { WireCitationSource } from './wire-citation-source'

export type ChatStore = MessagesSlice & SessionsSlice & InteractionSlice
