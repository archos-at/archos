import type { Translator } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import { compact, labelled, type DocBlock, type DocRun } from './blocks'
import { legalBasisBlocks } from './excerpts'
import type { QuoteStamp } from '@/lib/conversations/message-quote-stamps'
import { cardsBlocks } from './cards'
import { findingsBlocks } from './findings'
import { referencesFromStored, splitProse, type ReferenceEntry } from './citations'
import { markdownToBlocks } from './markdown'

const CAPPED_REASON_COPY = {
  ungrounded: 'ungrounded',
  quote_unverified: 'quoteUnverified',
  law_unsettled: 'lawUnsettled',
  open_point: 'openPoint',
} as const
export const EXPORTED_CAPPED_REASONS = Object.keys(CAPPED_REASON_COPY) as [
  ExportedCappedReason,
  ...ExportedCappedReason[],
]
export type ExportedCappedReason = keyof typeof CAPPED_REASON_COPY

export interface AnswerConfidence {
  level: 'low' | 'medium' | 'high'
  reason?: string
  cappedReason?: ExportedCappedReason
}

export interface AnswerDocumentInput {
  conversationTitle?: string | null
  projectName?: string | null
  question?: string | null
  answer: string
  createdAt?: Date | null
  citations?: unknown
  cards?: unknown
  quoteStamps?: readonly QuoteStamp[]
  findings?: unknown
  confidence?: AnswerConfidence | null
  // The printed notice only; the machine-readable marking is on every export (Art. 50(2) AI Act; the Commission's Art. 50 guidelines, 2026-11-05, points 90-91, exempt only standard editing).
  agentAuthored?: boolean
  diagramPlaceholder?: string
}

export const aiNoticeText = (t: Translator): { title: string; body: string } => ({
  title: t('aiNotice.title'),
  body: t('aiNotice.body'),
})

export const agentNotice = (t: Translator): DocBlock => {
  const { title, body } = aiNoticeText(t)
  return {
    kind: 'table',
    rows: [[[{ text: `${title}\n`, bold: true }, { text: body }]]],
  }
}

export const referenceParagraph = (entry: ReferenceEntry): DocBlock => {
  const runs: DocRun[] = [{ text: `[${entry.number}] `, bold: true }, { text: entry.label }]
  if (entry.page) runs.push({ text: `, ${entry.page}` })
  if (entry.note) runs.push({ text: ` — ${entry.note}`, italic: true })
  if (entry.url) runs.push({ text: `\n${entry.url}` })
  return { kind: 'paragraph', runs }
}

const confidenceBlocks = (confidence: AnswerConfidence, t: Translator): DocBlock[] => {
  const level = t(`confidenceLevels.${confidence.level}`)
  const blocks: DocBlock[] = [labelled(t('confidence'), level)]
  if (confidence.cappedReason) {
    const key = CAPPED_REASON_COPY[confidence.cappedReason]
    blocks.push({
      kind: 'paragraph',
      runs: [{ text: t(`confidenceCapped.${key}`) }],
      style: 'meta',
    })
  }
  if (confidence.reason?.trim()) {
    blocks.push({
      kind: 'paragraph',
      runs: [
        { text: `${t('confidenceReason')}: `, bold: true },
        { text: confidence.reason.trim() },
      ],
      style: 'meta',
    })
  }
  return blocks
}

export interface DocumentFact {
  label: string
  value: string
  mono?: boolean
}

export interface AnswerSections {
  title: string
  facts: DocumentFact[]
  notice: { title: string; body: string } | null
  body: DocBlock[]
}

export function buildAnswerSections(
  input: AnswerDocumentInput,
  t: Translator,
  locale: Locale
): AnswerSections {
  const { body, references: written } = splitProse(input.answer ?? '')
  const stored = referencesFromStored(input.citations, t)
  const references = stored.length > 0 ? stored : written

  const title = input.conversationTitle?.trim() || t('documentTitle')

  const notice = input.agentAuthored ? aiNoticeText(t) : null

  const projectName = input.projectName?.trim()
  const facts: DocumentFact[] = [
    ...(projectName ? [{ label: t('project'), value: projectName }] : []),
    ...(input.createdAt
      ? [
          {
            label: t('createdAt'),
            value: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(input.createdAt),
          },
        ]
      : []),
  ]

  const question = input.question?.trim()
  const questionSection: (DocBlock | null)[] = question
    ? [
        { kind: 'heading', level: 2, text: t('question') },
        { kind: 'paragraph', runs: [{ text: question }], style: 'quote' },
      ]
    : []

  const prose = markdownToBlocks(body, { diagramPlaceholder: input.diagramPlaceholder })
  const answerSection: (DocBlock | null)[] =
    prose.length > 0 ? [{ kind: 'heading', level: 2, text: t('answer') }, ...prose] : []

  const confidence = input.confidence ? confidenceBlocks(input.confidence, t) : []

  const legalBasis = legalBasisBlocks(body, references, t, input.quoteStamps)

  const findings = findingsBlocks(input.findings, t)
  const cards = cardsBlocks(input.cards, t, { diagramPlaceholder: input.diagramPlaceholder })
  const cardSection: DocBlock[] =
    cards.length > 0 ? [{ kind: 'heading', level: 2, text: t('findings') }, ...cards] : []

  const sourceSection: DocBlock[] =
    references.length > 0
      ? [{ kind: 'heading', level: 2, text: t('sources') }, ...references.map(referenceParagraph)]
      : []

  return {
    title,
    facts,
    notice,
    body: compact([
      ...questionSection,
      ...answerSection,
      ...confidence,
      ...legalBasis,
      ...findings,
      ...cardSection,
      ...sourceSection,
    ]),
  }
}

export function buildAnswerDocument(
  input: AnswerDocumentInput,
  t: Translator,
  locale: Locale
): DocBlock[] {
  const { title, facts, notice, body } = buildAnswerSections(input, t, locale)
  return compact([
    ...(notice ? [agentNotice(t)] : []),
    { kind: 'heading', level: 1, text: title },
    ...facts.map((fact) => labelled(fact.label, fact.value)),
    ...body,
  ])
}
