import type {
  AnswerCalloutKind,
  AnswerMeta,
  AnswerMetaTakeaway,
  AnswerMetaWork,
} from '@/lib/conversations/message-answer-meta'
import type { NormReferenceData } from '@/shared/cards/schemas'

export interface AnatomyVerdict {
  type: 'verdict_header'
  verdict: string
  subject: string
  reference: NormReferenceData | null
  confidence: 'low' | 'medium' | 'high' | null
  confidence_reason: string | null
}

export interface AnatomyCallout {
  type: 'callout'
  kind: AnswerCalloutKind
  text: string
  title: string | null
  detail: string | null
}

export interface AnatomyTakeaways {
  type: 'key_takeaways'
  title: string | null
  items: AnswerMetaTakeaway[]
}

export interface AnatomyWork extends AnswerMetaWork {
  type: 'work_report'
}

export type AnatomyShape = AnatomyCallout | AnatomyTakeaways | AnatomyWork

export interface AnswerAnatomy {
  summary?: string
  topic?: string
  context?: string
  verdict?: AnatomyVerdict
  callout?: AnatomyCallout
  takeaways?: AnatomyTakeaways
  work?: AnatomyWork
  below: AnatomyShape[]
}

export function answerMetaToAnatomy(meta: AnswerMeta | undefined): AnswerAnatomy | null {
  if (!meta) return null

  const verdict: AnatomyVerdict | undefined = meta.verdict
    ? {
        type: 'verdict_header',
        verdict: meta.verdict.value,
        subject: meta.verdict.subject,
        reference: meta.verdict.reference
          ? {
              document: meta.verdict.reference.document,
              section: meta.verdict.reference.section ?? null,
              edition: meta.verdict.reference.edition ?? null,
              excerpt: null,
            }
          : null,
        confidence: null,
        confidence_reason: null,
      }
    : undefined

  const callout: AnatomyCallout | undefined = meta.callout
    ? {
        type: 'callout',
        kind: meta.callout.kind,
        text: meta.callout.text,
        title: meta.callout.title ?? null,
        detail: meta.callout.detail ?? null,
      }
    : undefined

  const takeaways: AnatomyTakeaways | undefined =
    meta.takeaways && meta.takeaways.length >= 2
      ? {
          type: 'key_takeaways',
          title: null,
          items: meta.takeaways.map((t) => ({ text: t.text, detail: t.detail })),
        }
      : undefined

  const summary = meta.summary
  const topic = meta.topic
  const context = meta.context

  const work: AnatomyWork | undefined = meta.work ? { type: 'work_report', ...meta.work } : undefined

  if (!summary && !topic && !context && !verdict && !callout && !takeaways && !work) return null

  const below: AnatomyShape[] = []
  if (work) below.push(work)
  if (callout) below.push(callout)
  if (takeaways) below.push(takeaways)
  return { summary, topic, context, verdict, callout, takeaways, work, below }
}

export function summaryDuplicatesBody(
  summary: string | undefined | null,
  body: string | undefined | null
): boolean {
  if (!summary || !body) return false
  const normalizedSummary = normalizeForComparison(summary)
  if (!normalizedSummary) return false
  const first = firstBodySentence(body)
  if (!first) return false
  return normalizedSummary === normalizeForComparison(first)
}

function normalizeForComparison(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  const withoutCitations = collapsed.replace(/(\s*\[\d+\])+$/, '').trim()
  return withoutCitations.toLowerCase()
}

function firstBodySentence(body: string): string {
  const paragraph = body.trimStart().split(/\n\s*\n/)[0] ?? ''
  const match = paragraph.match(/^[\s\S]*?[.!?\u2026](?:\s*\[\d+\])*(?=\s|$)/)
  return (match ? match[0] : paragraph).trim()
}
