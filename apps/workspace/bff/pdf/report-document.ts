import { legalBasisBlocks } from '@/lib/answer-export/excerpts'
import { marked } from 'marked'
import { z } from 'zod'
import {
  aiNoticeText,
  buildAnswerSections,
  EXPORTED_CAPPED_REASONS,
  referenceParagraph,
  type AnswerSections,
} from '@/lib/answer-export/answer-document'
import type { DocBlock } from '@/lib/answer-export/blocks'
import { splitProse } from '@/lib/answer-export/citations'
import { markdownToBlocks } from '@/lib/answer-export/markdown'
import { resolveLocale, type Locale } from '@/i18n/config'
import { translatorFor } from '@/i18n/namespace'
import type { Translator } from '@/i18n/translate'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'

export const pdfRequestSchema = z
  .object({
    markdown: z.string().nullish(),
    title: z.string().nullish(),
    projectName: z.string().nullish(),
    question: z.string().nullish(),
    createdAt: z.string().nullish(),
    cards: z.unknown().optional(),
    citations: z.unknown().optional(),
    confidence: z
      .object({
        level: z.enum(['low', 'medium', 'high']),
        reason: z.string().nullish(),
        cappedReason: z.enum(EXPORTED_CAPPED_REASONS).nullish(),
      })
      .nullish(),
    locale: z.string().nullish(),
    aiProvenance: z.string().optional(),
    diagramPlaceholder: z.string().optional(),
    facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  })
  .passthrough()

export type PdfRequest = z.infer<typeof pdfRequestSchema>

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const hasContent = (request: PdfRequest): boolean =>
  Boolean(trimmed(request.markdown)) || (Array.isArray(request.cards) && request.cards.length > 0)

const isRichRequest = (request: PdfRequest): boolean =>
  Boolean(
    trimmed(request.title) ||
      trimmed(request.projectName) ||
      trimmed(request.question) ||
      trimmed(request.createdAt) ||
      request.cards !== undefined ||
      request.citations !== undefined ||
      request.confidence
  )

const liftLeadingTitle = (markdown: string): { title: string | null; body: string } => {
  const tokens = marked.lexer(markdown)
  const first = tokens.find((token) => token.type !== 'space')
  if (!first || first.type !== 'heading' || first.depth !== 1) return { title: null, body: markdown }

  const heading = first as { text: string; raw: string }
  const title = heading.text.trim()
  if (!title) return { title: null, body: markdown }

  const start = markdown.indexOf(heading.raw)
  return start === -1
    ? { title, body: markdown }
    : { title, body: markdown.slice(start + heading.raw.length) }
}

const reportSections = (
  markdown: string,
  request: PdfRequest,
  t: Translator
): AnswerSections => {
  const { body, references } = splitProse(markdown)
  const lifted = liftLeadingTitle(body)

  const projectName = trimmed(request.projectName)
  const created = parseDate(request.createdAt)

  return {
    title: trimmed(request.title) ?? lifted.title ?? t('documentTitle'),
    notice: request.aiProvenance ? aiNoticeText(t) : null,
    facts: [
      ...(projectName ? [{ label: t('project'), value: projectName }] : []),
      ...(created
        ? [
            {
              label: t('createdAt'),
              value: new Intl.DateTimeFormat(resolveLocale(request.locale), {
                dateStyle: 'long',
              }).format(created),
            },
          ]
        : []),
      ...(request.facts ?? []),
    ],
    body: [
      ...markdownToBlocks(lifted.body, { diagramPlaceholder: request.diagramPlaceholder }),
      ...legalBasisBlocks(lifted.body, references, t),
      ...(references.length > 0
        ? ([
            { kind: 'heading', level: 2, text: t('sources') },
            ...references.map(referenceParagraph),
          ] as DocBlock[])
        : []),
    ],
  }
}

export function documentSections(request: PdfRequest): { sections: AnswerSections; locale: Locale } {
  const locale = resolveLocale(request.locale)
  const t = translatorFor(answerExportCopy, locale)
  const markdown = request.markdown ?? ''

  if (!isRichRequest(request)) {
    return { sections: reportSections(markdown, request, t), locale }
  }

  const given = trimmed(request.title)
  const lifted = given ? { title: null, body: markdown } : liftLeadingTitle(markdown)

  const sections = buildAnswerSections(
    {
      conversationTitle: given ?? lifted.title ?? null,
      projectName: trimmed(request.projectName) ?? null,
      question: trimmed(request.question) ?? null,
      answer: lifted.body,
      createdAt: parseDate(request.createdAt),
      citations: request.citations,
      cards: request.cards,
      agentAuthored: Boolean(request.aiProvenance),
      diagramPlaceholder: request.diagramPlaceholder,
      confidence: request.confidence
        ? {
            level: request.confidence.level,
            ...(trimmed(request.confidence.reason)
              ? { reason: trimmed(request.confidence.reason) }
              : {}),
            ...(request.confidence.cappedReason
              ? { cappedReason: request.confidence.cappedReason }
              : {}),
          }
        : null,
    },
    t,
    locale
  )

  return {
    sections: { ...sections, facts: [...sections.facts, ...(request.facts ?? [])] },
    locale,
  }
}
