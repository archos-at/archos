import { z } from 'zod'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { conversationIdSchema } from '@/lib/session-documents/conversation-id'
import { PRODUCT_NAME } from '@/lib/brand'
import type { SOURCE_KINDS } from '@/shared/vocabularies.generated'

type SourceKind = (typeof SOURCE_KINDS)[number]

export const ASK_STATES = ['submitted', 'working', 'completed', 'canceled', 'failed', 'rejected'] as const
export type AskState = (typeof ASK_STATES)[number]

export const ASK_LIFECYCLE = defineLifecycle<AskState, 'start' | 'complete' | 'cancel' | 'fail' | 'reject'>({
  id: 'agent-ask',
  initial: 'submitted',
  states: {
    submitted: { on: { start: 'working', complete: 'completed', cancel: 'canceled', fail: 'failed', reject: 'rejected' } },
    working: { on: { complete: 'completed', cancel: 'canceled', fail: 'failed', reject: 'rejected' } },
    completed: { type: 'final' },
    canceled: { type: 'final' },
    failed: { type: 'final' },
    rejected: { type: 'final' },
  },
})

export const TERMINAL_ASK_STATES: ReadonlySet<AskState> = new Set<AskState>(ASK_LIFECYCLE.finalStates)

export const isTerminalAskState = (state: AskState): boolean => TERMINAL_ASK_STATES.has(state)

export const AGENT_ASK_OPERATIONS = ['agent-ask-create', 'agent-ask-get', 'agent-ask-cancel'] as const

export const isAgentAskOperation = (name: string): boolean =>
  (AGENT_ASK_OPERATIONS as readonly string[]).includes(name)

export const MAX_QUESTION_CHARS = 8_000

export const ASK_WAIT_SECONDS = 40

export const CHAT_TURN_DEADLINE_SECONDS = 2_700

const OUTCOME_NOTICE_GRACE_SECONDS = 120

export const DEFAULT_ASK_MAX_SECONDS = CHAT_TURN_DEADLINE_SECONDS + OUTCOME_NOTICE_GRACE_SECONDS

export const createAskSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUESTION_CHARS)
      .describe('The question or request for ' + PRODUCT_NAME + ', in the words the person would use, German or English.'),
    projectId: z
      .string()
      .guid()
      .optional()
      .describe('The project ' + PRODUCT_NAME + ' should answer in, from project-list. Omit for the office as a whole.'),
    conversationId: conversationIdSchema
      .optional()
      .describe(
        'Continue an earlier ask: its conversationId, from agent-ask-create or agent-ask-get. ' +
          PRODUCT_NAME + ' then sees the earlier questions and answers. Omit to start a new conversation.',
      ),
    waitSeconds: z
      .number()
      .int()
      .min(0)
      .max(ASK_WAIT_SECONDS)
      .optional()
      .describe(
        `How long to wait for the answer before returning (default and most ${ASK_WAIT_SECONDS}); 0 returns the ` +
          'ask at once, and agent-ask-get reads it later.',
      ),
  })
  .strict()
export type CreateAskRequest = z.infer<typeof createAskSchema>

export const askParamsSchema = z.object({
  id: z.guid().describe('The ask id, from agent-ask-create.'),
})

export const getAskQuerySchema = z
  .object({
    waitSeconds: z.coerce
      .number()
      .int()
      .min(0)
      .max(ASK_WAIT_SECONDS)
      .optional()
      .describe(`Wait up to this many seconds (at most ${ASK_WAIT_SECONDS}) for the answer before returning.`),
  })
  .strict()
export type GetAskQuery = z.infer<typeof getAskQuerySchema>

export interface AskDocument {
  documentId: string
  versionId: string
  name: string
  projectId: string | null
  contentType: string | null
}

export interface AskSource {
  documentId: string
  name: string
  page?: number
  clause?: string
  kind: SourceKind
  url: string
  citation: string
}

export interface AskConfidence {
  level: 'low' | 'medium' | 'high'
  reason?: string
  cappedReason?: string
  lookupFoundNothing?: true
}

export interface AskAnswerEvidence {
  sources?: AskSource[]
  confidence?: AskConfidence
}

export interface AskView {
  id: string
  conversationId: string
  projectId: string | null
  state: AskState
  question: string | null
  reason: string | null
  answer: ({ messageId: string; text: string } & AskAnswerEvidence) | null
  documents: AskDocument[]
  createdAt: string
  updatedAt: string
  endedAt: string | null
  pollAfterSeconds: number | null
}
