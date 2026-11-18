import type { CitationEventKind } from '@/lib/db/schema/citation-events'
import type { MissingSourceCandidate } from './missing-sources'
import type * as repository from './repository'
import type { CitationFinding, CitationKindTotal, CitationOrganizationTotal, CitationReasonTotal } from './citation-types'

const THRESHOLDS = {
  ungroundedShare: 0.01,
  quotesShare: 0.02,
  fallbackShare: 0.05,
  removedShare: 0.05,
  inventedReasonShare: 0.4,
  duplicateReasonShare: 0.5,
  outlierMinTurns: 20,
  outlierRateMultiple: 2,
} as const

const SEVERITY_RANK: Record<CitationFinding['severity'], number> = { error: 0, warn: 1, info: 2 }

export function findOrganizationOutlier<
  T extends Pick<CitationOrganizationTotal, 'organizationId' | 'turns' | 'defectRate'>,
>(organizations: T[], platformRate: number): T | undefined {
  if (platformRate <= 0) return undefined
  return organizations.find(
    (org) =>
      org.organizationId !== null &&
      org.turns >= THRESHOLDS.outlierMinTurns &&
      org.defectRate >= platformRate * THRESHOLDS.outlierRateMultiple
  )
}

export function buildFindings(input: {
  turns: number
  defectTurns: number
  byKind: CitationKindTotal[]
  reasons: CitationReasonTotal[]
  organizations: CitationOrganizationTotal[]
  unavailableTools: repository.UnavailableToolRow[]
  unavailableToolCount?: number
  missingSources?: MissingSourceCandidate[]
  missingSourceTurns?: { held: number; addable: number }
}): CitationFinding[] {
  const { turns, defectTurns, byKind, reasons, organizations, unavailableTools } = input
  const missingSources = input.missingSources ?? []
  if (turns === 0) return []

  const kindTurns = (kind: CitationEventKind): number =>
    byKind.find((row) => row.kind === kind)?.turns ?? 0
  const kindItems = (kind: CitationEventKind): number =>
    byKind.find((row) => row.kind === kind)?.items ?? 0
  const reasonShare = (...keys: string[]): number =>
    reasons
      .filter((row) => row.kind === 'citations_removed' && keys.includes(row.reason))
      .reduce((sum, row) => sum + row.share, 0)

  const findings: CitationFinding[] = []

  const unheld = missingSources.filter((candidate) => candidate.present === false)
  const addable = unheld.filter((candidate) => isAddable(candidate))
  const heldButUnretrieved = missingSources.filter((candidate) => candidate.present === true)
  const boundedTurns = (candidates: MissingSourceCandidate[], exact: number | undefined): number =>
    exact ??
    Math.min(
      defectTurns,
      candidates.reduce((sum, candidate) => sum + candidate.turns, 0)
    )

  const emptyTurns = kindTurns('registry_empty')
  if (emptyTurns > 0) {
    findings.push({
      id: 'retrieval_unavailable',
      severity: 'error',
      subject: unavailableTools[0] ? { type: 'tool', label: unavailableTools[0].tool } : null,
      metrics: { turns: emptyTurns, tools: input.unavailableToolCount ?? unavailableTools.length },
    })
  }

  const ungroundedTurns = kindTurns('answer_ungrounded')
  if (ungroundedTurns / turns >= THRESHOLDS.ungroundedShare) {
    findings.push({
      id: 'answers_ungrounded',
      severity: 'error',
      subject: null,
      metrics: { turns: ungroundedTurns, share: ungroundedTurns / turns },
    })
  }

  const removedTurns = kindTurns('citations_removed')
  const inventedShare = reasonShare('url_not_in_registry', 'citation_key_not_in_registry')
  const inventionUnexplained =
    missingSources.length === 0 || missingSources.some((candidate) => candidate.present !== true)
  if (
    removedTurns / turns >= THRESHOLDS.removedShare &&
    inventedShare >= THRESHOLDS.inventedReasonShare &&
    inventionUnexplained
  ) {
    findings.push({
      id: 'citations_invented',
      severity: 'warn',
      subject: null,
      metrics: {
        turns: removedTurns,
        citations: kindItems('citations_removed'),
        share: inventedShare,
        unheld: unheld.length,
      },
    })
  }

  const quoteTurns = kindTurns('quote_unverified')
  if (quoteTurns / turns >= THRESHOLDS.quotesShare) {
    findings.push({
      id: 'quotes_fabricated',
      severity: 'warn',
      subject: null,
      metrics: {
        turns: quoteTurns,
        quotes: kindItems('quote_unverified'),
        share: quoteTurns / turns,
      },
    })
  }

  const fallbackTurns = kindTurns('citation_fallback')
  if (fallbackTurns / turns >= THRESHOLDS.fallbackShare) {
    findings.push({
      id: 'citation_format_unparsed',
      severity: 'warn',
      subject: null,
      metrics: { turns: fallbackTurns, share: fallbackTurns / turns },
    })
  }

  const platformRate = defectTurns / turns
  const outlier = findOrganizationOutlier(organizations, platformRate)
  if (outlier) {
    findings.push({
      id: 'organization_outlier',
      severity: 'warn',
      subject: { type: 'organization', label: outlier.name ?? outlier.organizationId! },
      metrics: {
        share: outlier.defectRate,
        platformShare: platformRate,
        turns: outlier.defectTurns,
      },
    })
  }

  if (addable.length > 0) {
    findings.push({
      id: 'sources_missing',
      severity: 'warn',
      subject: { type: 'tool', label: addable[0].fileName ?? addable[0].target },
      metrics: {
        sources: addable.length,
        turns: boundedTurns(addable, input.missingSourceTurns?.addable),
        automatic: addable.filter((candidate) => candidate.action === 'add_to_norm_catalog').length,
      },
    })
  }

  if (heldButUnretrieved.length > 0) {
    findings.push({
      id: 'sources_unretrievable',
      severity: 'warn',
      subject: {
        type: 'tool',
        label: heldButUnretrieved[0].fileName ?? heldButUnretrieved[0].target,
      },
      metrics: {
        sources: heldButUnretrieved.length,
        turns: boundedTurns(heldButUnretrieved, input.missingSourceTurns?.held),
      },
    })
  }

  if (defectTurns > 0 && reasonShare('duplicate') >= THRESHOLDS.duplicateReasonShare) {
    findings.push({
      id: 'duplicates_only',
      severity: 'info',
      subject: null,
      metrics: { share: reasonShare('duplicate') },
    })
  }

  if (findings.length === 0) {
    return [
      {
        id: 'all_clear',
        severity: 'info',
        subject: null,
        metrics: { turns, share: 1 - platformRate },
      },
    ]
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.metrics.turns ?? 0) - (a.metrics.turns ?? 0)
  )
}

export const isAddable = (candidate: MissingSourceCandidate): boolean =>
  candidate.action === 'add_to_norm_catalog' || candidate.action === 'upload_to_base_knowledge'
