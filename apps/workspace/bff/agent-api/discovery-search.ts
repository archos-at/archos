import 'server-only'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { PRODUCT_NAME } from '@/lib/brand'
import { type SearchableOperation, operationScorer } from '@/lib/text/operation-search'
import { AGENT_OPERATIONS } from './catalog'
import { failure, success } from './discovery-results'
import { annotationsOf } from './operation'
import { canSee, doorOfPrincipal, isOnDoor, visibleBackendOperations, visibleDomains, visibleOperations } from './policy'
import type { AgentPrincipal } from './principal'
import { type McpCallContext, recordOperationCalled } from './telemetry'

export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 50
export const MAX_SEARCH_QUERY_LENGTH = 200

interface Hit {
  name: string
  summary: string
  domain: string
  readOnly: boolean
  destructive: boolean
  score: number
}

function scorerFor(ctx: McpCallContext, query: string): (op: SearchableOperation) => number {
  return operationScorer(query, [...visibleOperations(ctx.principal), ...visibleBackendOperations(ctx.principal)])
}

export function rank(ctx: McpCallContext, query: string, domain: string | undefined): Hit[] {
  const score = scorerFor(ctx, query)
  const catalog: Hit[] = visibleOperations(ctx.principal)
    .filter((op) => !domain || op.domain === domain)
    .map((op) => {
      const annotations = annotationsOf(op)
      return {
        name: op.name,
        summary: op.summary,
        domain: op.domain,
        readOnly: annotations.readOnlyHint,
        destructive: annotations.destructiveHint,
        score: score(op),
      }
    })
  const backend: Hit[] = visibleBackendOperations(ctx.principal)
    .filter((op) => !domain || op.domain === domain)
    .map((op) => ({
      name: op.name,
      summary: op.summary,
      domain: op.domain,
      readOnly: op.annotations.readOnlyHint,
      destructive: op.annotations.destructiveHint,
      score: score(op),
    }))
  return [...catalog, ...backend]
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
}

function searchInput(principal: AgentPrincipal) {
  const domains = visibleDomains(doorOfPrincipal(principal)) as [string, ...string[]]
  return z.object({
    query: z.string().max(MAX_SEARCH_QUERY_LENGTH),
    domain: z.enum(domains).optional(),
    limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
  })
}

export const SENSITIVE_MATCH_NOTE =
  'An operation that changes who may do what, a credential or a security control matches this request, and it ' +
  'is not offered to you: none of the operations listed does that. Tell the person to make that change in ' + PRODUCT_NAME + ' themselves.'

function sensitiveMatchOutranks(ctx: McpCallContext, query: string, domain: string | undefined, best: number): boolean {
  const score = scorerFor(ctx, query)
  return AGENT_OPERATIONS.some(
    (op) =>
      op.sensitivity !== undefined &&
      isOnDoor(op.name, doorOfPrincipal(ctx.principal)) &&
      (!domain || op.domain === domain) &&
      !canSee(ctx.principal, op) &&
      score(op) > 0 &&
      score(op) >= best,
  )
}

export function nothingMatched(ctx: McpCallContext): string {
  const visible = new Set(visibleBackendOperations(ctx.principal).map((op) => op.name))
  for (const op of visibleOperations(ctx.principal)) visible.add(op.name)
  const readers = CONTENT_READERS.filter(({ name }) => visible.has(name)).map(({ name, what }) => `${name} (${what})`)
  const retry = 'try other words (the catalog is English), drop the domain filter, or call report-missing-operation.'
  if (readers.length === 0) return `Nothing matched. Try ${retry.slice(4)}`
  return (
    "Nothing matched. The catalog lists actions, not what documents say: for a question about a document's or " +
    `the law's content, call ${readers.join(', or ')}. Otherwise ${retry}`
  )
}

const CONTENT_READERS = [
  { name: 'knowledge-search', what: 'quotable passages from the project, the office and the building-law corpus' },
  { name: 'law-lookup', what: 'a provision of Austrian law' },
  { name: 'agent-ask-create', what: PRODUCT_NAME + ' answers it with sources' },
] as const

export function searchOperations(ctx: McpCallContext, args: unknown): CallToolResult {
  const startedAt = Date.now()
  const parsed = searchInput(ctx.principal).safeParse(args)
  if (!parsed.success) return failure(`search-operations: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  const { query, domain, limit = DEFAULT_SEARCH_LIMIT } = parsed.data
  const hits = rank(ctx, query, domain)
  const shown = hits.slice(0, limit).map(({ score: _score, ...hit }) => hit)
  recordOperationCalled(ctx, { operation: 'search-operations', domain: domain ?? null, decision: 'run', status: 200, startedAt })
  const next =
    shown.length === 0
      ? nothingMatched(ctx)
      : 'Call call-operation with the name; call describe-operation first when you do not know its input.'
  const hidden = query.trim() !== '' && sensitiveMatchOutranks(ctx, query, domain, hits[0]?.score ?? 0)
  return success({ total: hits.length, operations: shown, next: hidden ? `${SENSITIVE_MATCH_NOTE} ${next}` : next })
}
