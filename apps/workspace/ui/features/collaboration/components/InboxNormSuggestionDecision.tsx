'use client'

import type { JSX } from 'react'
import { useState } from 'react'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { NormRecognition, SettleProposalsBody } from '@/lib/base-knowledge/wire'
import { applyProposal, dismissProposal, getProposal, ProposalRequestError } from '@/lib/proposals/client'
import type { ApplyProposalBody, OfficeShelfNormPayload, ProposalResponse } from '@/lib/proposals/types'
import { Button } from '@/components/ui/button'
import { useNormDialog } from '@/components/norms/norm-dialog-slot'

export interface InboxNormDecisionClient {
  read: (proposalId: string) => Promise<ProposalResponse>
  apply: (proposalId: string, body: ApplyProposalBody) => Promise<ProposalResponse>
  dismiss: (proposalId: string) => Promise<ProposalResponse>
}

export const NORM_DECISION_CLIENT: InboxNormDecisionClient = {
  read: (proposalId) => getProposal(proposalId),
  apply: (proposalId, body) => applyProposal(proposalId, body),
  dismiss: (proposalId) => dismissProposal(proposalId),
}

type Outcome = { kind: 'accepted' | 'declined' | 'stale' } | { kind: 'failed' | 'unconfirmed'; reason: string }

type NormRow = SettleProposalsBody['rows'][number]
type ConfirmedNorms = NonNullable<ApplyProposalBody['norms']>

export function suggestionRecognition(payload: OfficeShelfNormPayload): NormRecognition {
  return {
    proposals: payload.documents.map((document) => ({
      entryId: document.id,
      documentId: document.id,
      fileName: document.name,
      kind: document.kind ?? 'technical_standard',
      designation: document.designation,
      editionLabel: document.editionLabel ?? null,
      topicId: null,
      editionOf: null,
      duplicate: false,
    })),
    plain: [],
    topics: { rootId: null, folders: [], nextCursor: null },
  }
}

function confirmedNorms(rows: readonly NormRow[]): ConfirmedNorms | null {
  const norms = rows.flatMap((row) => {
    const editionLabel = row.editionLabel?.trim()
    if (!editionLabel) return []
    const designation = row.designation?.trim() || null
    return [{ documentId: row.entryId, values: { kind: row.kind ?? 'technical_standard', designation, editionLabel } }]
  })
  return norms.length === rows.length && norms.length > 0 ? norms : null
}

function outcomeOf(response: ProposalResponse): Outcome {
  const results = response.proposal.results ?? []
  const failed = results.find((result) => !result.ok)
  if (failed) return { kind: 'failed', reason: failed.reason ?? '' }
  const unconfirmed = results.find((result) => result.reason)
  return unconfirmed ? { kind: 'unconfirmed', reason: unconfirmed.reason ?? '' } : { kind: 'accepted' }
}

function outcomeOfError(error: unknown): Outcome {
  if (error instanceof ProposalRequestError && error.status === 409) return { kind: 'stale' }
  return { kind: 'failed', reason: error instanceof Error ? error.message : '' }
}

export function InboxNormSuggestionDecision({
  proposalId,
  client = NORM_DECISION_CLIENT,
}: {
  proposalId: string
  client?: InboxNormDecisionClient
}): JSX.Element {
  const NormDialog = useNormDialog()
  const t = useTranslations(collaborationCopy)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [recognition, setRecognition] = useState<NormRecognition | null>(null)

  const review = async () => {
    setBusy(true)
    try {
      const { proposal } = await client.read(proposalId)
      if (proposal.status !== 'proposed' || proposal.kind !== 'office_shelf_norm') setOutcome({ kind: 'stale' })
      else setRecognition(suggestionRecognition(proposal.payload))
    } catch (error) {
      setOutcome(outcomeOfError(error))
    } finally {
      setBusy(false)
    }
  }

  const accept = async (rows: readonly NormRow[]) => {
    const norms = confirmedNorms(rows)
    if (!norms) throw new Error(t('inbox.normSuggestion.editionNeeded'))
    try {
      setOutcome(outcomeOf(await client.apply(proposalId, { norms })))
    } catch (error) {
      setOutcome(outcomeOfError(error))
    }
  }

  const decline = async () => {
    setBusy(true)
    try {
      await client.dismiss(proposalId)
      setOutcome({ kind: 'declined' })
    } catch (error) {
      setOutcome(outcomeOfError(error))
    } finally {
      setBusy(false)
    }
  }

  const dialog = NormDialog && (
    <NormDialog
      recognition={recognition}
      onClose={() => setRecognition(null)}
      onSettled={() => setRecognition(null)}
      destination={{
        description: t('inbox.normSuggestion.confirmBody'),
        laterNotice: t('inbox.normSuggestion.later'),
        notNorm: false,
        confirm: accept,
      }}
    />
  )

  if (outcome && (outcome.kind === 'accepted' || outcome.kind === 'declined' || outcome.kind === 'stale')) {
    return (
      <p role="status" className="relative z-10 mt-2 text-xs text-muted-foreground" data-testid="inbox-norm-decided">
        {t(`inbox.normSuggestion.${outcome.kind}`)}
      </p>
    )
  }
  if (outcome?.kind === 'unconfirmed') {
    return (
      <p role="status" className="relative z-10 mt-2 text-xs text-warning" data-testid="inbox-norm-decided">
        {t('inbox.normSuggestion.unconfirmed', { reason: outcome.reason })}
      </p>
    )
  }
  return (
    <div className="relative z-10 mt-2 space-y-1.5" data-testid="inbox-norm-decision">
      <p className="text-xs text-muted-foreground">{t('inbox.normSuggestion.visibility')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={busy || !NormDialog}
          data-testid="inbox-norm-accept"
          onClick={() => void review()}
        >
          {t('inbox.normSuggestion.accept')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          disabled={busy}
          data-testid="inbox-norm-decline"
          onClick={() => void decline()}
        >
          {t('inbox.normSuggestion.decline')}
        </Button>
      </div>
      {outcome?.kind === 'failed' && (
        <p role="alert" className="text-xs text-error" data-testid="inbox-norm-failed">
          {t('inbox.normSuggestion.failed', { reason: outcome.reason })}
        </p>
      )}
      {dialog}
    </div>
  )
}
