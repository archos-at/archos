/**
 * The machine-readable AI mark on a door result: `_meta.aiGenerated`.
 *
 * Art. 50(2) AI Act asks the provider to mark generated text so that a machine
 * can tell; the MCP result's `_meta` is the protocol's place for metadata about
 * a result that is not the result itself, and a client that files, forwards or
 * shows an answer reads it there. `digitalSourceType` is the IPTC term the
 * exported PDF and `.docx` carry (`@/lib/ai-provenance`), so one detector
 * vocabulary covers the files and the wire.
 *
 * Only what a model wrote for THIS call is marked, as the operation declares
 * it (`AgentOperation.generatedContent`): an ask still `working` has no answer
 * yet, and a document read back from the workspace carries its own marking.
 */

import type { CallToolResult } from '@modelcontextprotocol/server'
import { IPTC_TRAINED_ALGORITHMIC_MEDIA } from '@/lib/ai-provenance'
import type { AgentOperation } from './operation'

/** What the mark says. Exported for the specs and for any other door path that shapes a result. */
export const AI_GENERATED_META = {
  aiGenerated: true,
  digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
} as const

/** `result`, marked when `body` carries the content `op` says a model wrote. */
export function withAiGeneratedMeta(
  op: Pick<AgentOperation, 'generatedContent'>,
  body: unknown,
  result: CallToolResult,
): CallToolResult {
  const key = op.generatedContent
  if (!key || result.isError || typeof body !== 'object' || body === null) return result
  const content = (body as Record<string, unknown>)[key]
  if (content === undefined || content === null) return result
  return { ...result, _meta: { ...result._meta, ...AI_GENERATED_META } }
}
