import type { CallToolResult } from '@modelcontextprotocol/server'
import { IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '@/lib/ai-provenance'
import type { AgentOperation } from './operation'

export type GeneratedShare = 'whole' | 'part'

export type GeneratedContent = (body: Readonly<Record<string, unknown>>) => GeneratedShare | null

export const AI_GENERATED_META = {
  aiGenerated: true,
  digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
} as const

export const AI_COMPOSITE_META = {
  aiGenerated: true,
  digitalSourceType: IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA,
} as const

const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === ''

export const generatedAt =
  (key: string): GeneratedContent =>
  (body) =>
    isEmpty(body[key]) ? null : 'whole'

export const generatedRows =
  (list: string, byModel: (row: Readonly<Record<string, unknown>>) => boolean): GeneratedContent =>
  (body) => {
    const rows = Array.isArray(body[list]) ? (body[list] as unknown[]) : []
    const written = rows.filter((row) => typeof row === 'object' && row !== null && byModel(row as Record<string, unknown>))
    if (written.length === 0) return null
    return written.length === rows.length ? 'whole' : 'part'
  }

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
