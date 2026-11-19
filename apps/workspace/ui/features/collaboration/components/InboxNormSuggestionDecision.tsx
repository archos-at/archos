'use client'

import type { JSX } from 'react'
import { useState } from 'react'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { applyProposal, dismissProposal, ProposalRequestError } from '@/lib/proposals/client'
import type { ProposalResponse } from '@/lib/proposals/types'
import { Button } from '@/components/ui/button'

export interface InboxNormDecisionClient {
  apply: (proposalId: string) => Promise<ProposalResponse>
  dismiss: (proposalId: string) => Promise<ProposalResponse>
}

export const NORM_DECISION_CLIENT: InboxNormDecisionClient = {
  apply: (proposalId) => applyProposal(proposalId),
  dismiss: (proposalId) => dismissProposal(proposalId),
}

type Outcome = { kind: 'accepted' | 'declined' | 'stale' } | { kind: 'failed'; reason: string }

export function InboxNormSuggestionDecision({
  proposalId,
  client = NORM_DECISION_CLIENT,
}: {
  proposalId: string
  client?: InboxNormDecisionClient
}): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const decide = async (decision: 'apply' | 'dismiss') => {
    setBusy(true)
    try {
      const { proposal } = await client[decision](proposalId)
      const failed = proposal.results?.find((result) => !result.ok)
      if (decision === 'apply' && failed) setOutcome({ kind: 'failed', reason: failed.reason ?? '' })
      else setOutcome({ kind: decision === 'apply' ? 'accepted' : 'declined' })
    } catch (error) {
      if (error instanceof ProposalRequestError && error.status === 409) setOutcome({ kind: 'stale' })
      else setOutcome({ kind: 'failed', reason: error instanceof Error ? error.message : '' })
    } finally {
      setBusy(false)
    }
  }

  if (outcome && outcome.kind !== 'failed') {
    return (
      <p role="status" className="relative z-10 mt-2 text-xs text-muted-foreground" data-testid="inbox-norm-decided">
        {t(`inbox.normSuggestion.${outcome.kind}`)}
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
          disabled={busy}
          data-testid="inbox-norm-accept"
          onClick={() => void decide('apply')}
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
          onClick={() => void decide('dismiss')}
        >
          {t('inbox.normSuggestion.decline')}
        </Button>
      </div>
      {outcome?.kind === 'failed' && (
        <p role="alert" className="text-xs text-error" data-testid="inbox-norm-failed">
          {t('inbox.normSuggestion.failed', { reason: outcome.reason })}
        </p>
      )}
    </div>
  )
}
