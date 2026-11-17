/**
 * The machine-readable AI mark on a door result: `_meta.aiGenerated`.
 *
 * Art. 50(2) AI Act asks the provider to mark generated text so that a machine
 * can tell; the MCP result's `_meta` is the protocol's place for metadata about
 * a result that is not the result itself, and a client that files, forwards or
 * shows an answer reads it there. `digitalSourceType` is the IPTC term the
 * exported PDF and `.docx` carry (`@/lib/ai-provenance`), so one detector
 * vocabulary covers the files and the wire: `trainedAlgorithmicMedia` when a
 * model wrote the text the result carries, `compositeWithTrainedAlgorithmicMedia`
 * when it carries a model's text beside a person's (a conversation's messages).
 *
 * ## Why the key carries no vendor prefix
 *
 * MCP reserves prefixes for itself and allows an unprefixed `_meta` key; a
 * prefix of ours would put the product's name into a wire name (ADR-0149
 * forbids that) or invent a domain no detector knows. No standard key for this
 * exists yet, so the plain name is the one a client can guess, and
 * `digitalSourceType` beside it is the standard's own word.
 *
 * Only what the operation declares (`AgentOperation.generatedContent`) is
 * marked, and only when the answer holds it: an ask still `working` has no
 * answer yet, and a document read back from the workspace carries its own
 * marking.
 */

import type { CallToolResult } from '@modelcontextprotocol/server'
import { IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '@/lib/ai-provenance'
import type { AgentOperation } from './operation'

/** How much of an answer a model wrote: all the text it carries, or part of it beside a person's. */
export type GeneratedShare = 'whole' | 'part'

/** Reads an operation's answer body and says how much of it a model wrote, or null for none. */
export type GeneratedContent = (body: Readonly<Record<string, unknown>>) => GeneratedShare | null

/** The mark for a result whose text a model wrote. Exported for the specs. */
export const AI_GENERATED_META = {
  aiGenerated: true,
  digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
} as const

/** The mark for a result that carries a model's text beside a person's. */
export const AI_COMPOSITE_META = {
  aiGenerated: true,
  digitalSourceType: IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA,
} as const

const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === ''

/** The answer's `key` holds text a model wrote for this call (an ask's `answer`, a summary). */
export const generatedAt =
  (key: string): GeneratedContent =>
  (body) =>
    isEmpty(body[key]) ? null : 'whole'

/** The answer's `list` holds rows, and a model wrote the ones `byModel` picks (an assistant's messages). */
export const generatedRows =
  (list: string, byModel: (row: Readonly<Record<string, unknown>>) => boolean): GeneratedContent =>
  (body) => {
    const rows = Array.isArray(body[list]) ? (body[list] as unknown[]) : []
    const written = rows.filter((row) => typeof row === 'object' && row !== null && byModel(row as Record<string, unknown>))
    if (written.length === 0) return null
    return written.length === rows.length ? 'whole' : 'part'
  }

/** `result`, marked when `body` carries content `op` says a model wrote. */
export function withAiGeneratedMeta(
  op: Pick<AgentOperation, 'generatedContent'>,
  body: unknown,
  result: CallToolResult,
): CallToolResult {
  if (!op.generatedContent || result.isError || typeof body !== 'object' || body === null) return result
  const share = op.generatedContent(body as Record<string, unknown>)
  if (share === null) return result
  return { ...result, _meta: { ...result._meta, ...(share === 'whole' ? AI_GENERATED_META : AI_COMPOSITE_META) } }
}
