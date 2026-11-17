import type { Translator } from '@/i18n'
import { citedLoci, type CitedDocument, type CitationLocus } from '../../../lib/citations'
import { documentShortName } from '../../../lib/document-names'
import { type AnswerDegradation, type DeepResearchCutoff } from '../../../lib/turn-events'
import { type FanCard } from '../../../lib/retrieval-rounds'

export const LIMIT = 'thinking.node.limits.'

const MIN_REPORTED_MINUTES = 1

const DEGRADATION_KEYS: Record<AnswerDegradation, string> = {
  no_report_file: 'noReport',
  no_valid_citations: 'noCitations',
  cards_generation_failed: 'noCards',
  basis_unread: 'basisUnread',
}

export function limitations(
  cutoff: DeepResearchCutoff | null,
  degradations: AnswerDegradation[],
  t: Translator
): Array<{ text: string; warn: boolean }> {
  const lines: Array<{ text: string; warn: boolean }> = []

  if (cutoff) {
    const cause =
      cutoff.reason === 'wall_clock' ? 'time' : cutoff.reason === 'step_limit' ? 'steps' : 'other'
    const outcome = cutoff.salvaged ? 'salvaged' : 'nothing'
    lines.push({
      text: `${t(`${LIMIT}deepCutoff.${cause}`)} ${t(`${LIMIT}deepCutoff.${outcome}`)}`,
      warn: false,
    })

    const context: string[] = []
    if (cutoff.sourceCount) {
      context.push(t(`${LIMIT}deepCutoff.sources`, { count: cutoff.sourceCount }))
    }
    const minutes = Math.floor((cutoff.elapsedSeconds ?? 0) / 60)
    if (minutes >= MIN_REPORTED_MINUTES) {
      context.push(t(`${LIMIT}deepCutoff.after`, { minutes }))
    }
    if (context.length > 0) lines.push({ text: context.join(' '), warn: false })
  }

  for (const reason of degradations) {
    lines.push({ text: t(`${LIMIT}degraded.${DEGRADATION_KEYS[reason]}`), warn: true })
  }

  return lines
}

function foldLocusOf(doc: CitedDocument): CitationLocus | undefined {
  const loci = citedLoci(doc)
  if (loci.length === 0) return undefined
  return (
    loci.find((locus) => locus.clause?.trim()) ??
    loci.find((locus) => typeof locus.page === 'number') ??
    loci[0]
  )
}

function foldLocusLabel(doc: CitedDocument, t: Translator): string | undefined {
  const locus = foldLocusOf(doc)
  if (!locus) return undefined
  const clause = locus.clause?.trim()
  const page = typeof locus.page === 'number' ? locus.page : undefined
  if (clause && page !== undefined)
    return t('thinking.node.roundFoldLocusClausePage', { clause, page })
  if (clause) return t('thinking.node.roundFoldLocusClause', { clause })
  if (page !== undefined) return t('thinking.node.roundFoldLocusPage', { page })
  return undefined
}

const foldName = (slot: FanCard): string =>
  slot.card
    ? documentShortName(slot.card.fileName ?? slot.card.title, slot.card.title)
    : documentShortName(slot.name, slot.title)

const foldLocus = (slot: FanCard, t: Translator): string | undefined => {
  if (slot.loci) return slot.loci[0]?.detail
  return slot.card ? foldLocusLabel(slot.card, t) : undefined
}

export function foldSummary(roundCards: FanCard[], t: Translator): string {
  const names = roundCards.map(foldName)
  if (names.length === 0) return ''
  if (names.length === 1) {
    const locus = foldLocus(roundCards[0]!, t)
    return locus
      ? t('thinking.node.roundFoldOne', { name: names[0], locus })
      : t('thinking.node.roundFoldOneBare', { name: names[0] })
  }
  if (names.length === 2)
    return t('thinking.node.roundFoldTwo', { first: names[0], second: names[1] })
  return t('thinking.node.roundFoldMany', { count: names.length, first: names[0] })
}
