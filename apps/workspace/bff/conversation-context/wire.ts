import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { COLLECTION_SHELVES } from '@/lib/retrieval-scope/collection-scope'
import { CONTEXT_KINDS, OTHER_PROJECT_REACHES, WORKSPACE_READS, type ConversationContext } from './types'

export const TURN_DECISION_HEADER = 'x-turn-decision'
export const TURN_DECISION_SIGNATURE_HEADER = 'x-turn-decision-signature'

export const TURN_DECISION_MAX_AGE_MS = 30 * 60 * 1000

const scopedCollectionSchema = z
  .object({
    collection: z.string().min(1).max(200),
    shelf: z.enum(COLLECTION_SHELVES).optional(),
    countries: z.array(z.string().min(1).max(8)).max(50).optional(),
  })
  .strict()

export const decisionMaySchema = z
  .object({
    shelves: z.array(scopedCollectionSchema).max(200),
    restrictedCollections: z.array(z.string().min(1).max(200)).max(200),
    otherProjects: z.object({ reach: z.enum(OTHER_PROJECT_REACHES), restrictedFolders: z.boolean() }).strict(),
    personalMemory: z.boolean(),
    personalShelf: z.boolean(),
    workspaceRead: z.enum(WORKSPACE_READS),
    features: z.object({ deepResearch: z.boolean(), tasks: z.boolean() }).strict(),
  })
  .strict()

export const conversationDecisionSchema = z
  .object({
    organizationId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128).nullable(),
    answerMessageId: z.guid().nullable(),
    kind: z.enum(CONTEXT_KINDS),
    solo: z.boolean(),
    recordedRestricted: z.boolean(),
    audienceVersion: z.number().int().min(0).nullable(),
    issuedAt: z.number().int().min(0),
    may: decisionMaySchema,
  })
  .strict()

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>

export const turnDecisionRequestSchema = z
  .object({ answerMessageId: z.guid().nullish() })
  .strict()

export const turnDecisionResponseSchema = z
  .object({ decision: z.string().min(1), signature: z.string().regex(/^[0-9a-f]{64}$/), body: conversationDecisionSchema })
  .strict()

export const CONVERSATION_DECISION_WIRE_SCHEMAS = {
  conversationDecision: conversationDecisionSchema,
  turnDecisionRequest: turnDecisionRequestSchema,
  turnDecisionResponse: turnDecisionResponseSchema,
}

export function conversationDecisionJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(CONVERSATION_DECISION_WIRE_SCHEMAS, {
    title: 'Conversation decision wire contract (ADR-0194)',
    description:
      'Generated from apps/workspace/bff/conversation-context/wire.ts. Do not edit by hand: ' +
      'wire.spec.ts rewrites this file and fails when it is stale.',
  })
}

export interface DecisionAsker {
  organizationId: string
  userId: string
}

export function decisionOf(
  context: ConversationContext,
  asker: DecisionAsker,
  answerMessageId: string | null,
  issuedAt: number,
): ConversationDecision {
  const { shelves, restrictedCollections, otherProjects, personalMemory, personalShelf, workspaceRead, features } =
    context.may
  return {
    organizationId: asker.organizationId,
    userId: asker.userId,
    conversationId: context.conversationId,
    answerMessageId,
    kind: context.kind,
    solo: context.audience.solo,
    recordedRestricted: context.recorded.folders.length > 0,
    audienceVersion: context.audience.version,
    issuedAt,
    may: { shelves, restrictedCollections, otherProjects, personalMemory, personalShelf, workspaceRead, features },
  }
}

export interface SignedDecision {
  header: string
  signature: string
}

function sign(json: string, secret: string): string {
  return createHmac('sha256', secret).update(json, 'utf8').digest('hex')
}

export function signDecision(decision: ConversationDecision, secret: string): SignedDecision {
  const json = JSON.stringify(conversationDecisionSchema.parse(decision))
  return { header: Buffer.from(json, 'utf8').toString('base64url'), signature: sign(json, secret) }
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export function verifyDecision(
  header: string | null | undefined,
  signature: string | null | undefined,
  secret: string | null | undefined,
  now: number = Date.now(),
): ConversationDecision | null {
  if (!header || !signature || !secret) return null
  const json = Buffer.from(header, 'base64url').toString('utf8')
  if (!/^[0-9a-f]{64}$/.test(signature) || !sameHex(sign(json, secret), signature)) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = conversationDecisionSchema.safeParse(raw)
  if (!parsed.success) return null
  if (Math.abs(now - parsed.data.issuedAt) > TURN_DECISION_MAX_AGE_MS) return null
  return parsed.data
}
