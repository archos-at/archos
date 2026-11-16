'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { selectCardConversationId, useCardDecision } from '../hooks/use-card-decision'
import { useChatStore } from '@/features/chat/store'
import { invalidateProjectFacts } from '@/features/chat/hooks/use-project-facts'
import { ProfilePatchReceipt } from './ProposalReceipts'
import { ProfilePatchTable } from './ProfilePatchTable'
import { DECISION_BUTTON, DECISION_ROW } from './card-chrome'
import { ProposalShell } from './ProposalShell'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useCurrentProfile } from '../hooks/use-current-profile'
import { buildPatchPreviewRows } from '@/lib/project-profile/patch-preview'
import type { ProjectProfilePatchOperation } from '@/lib/project-profile/types'

interface ProjectProfilePatchCardProps {
  title: string
  rationale: string
  patch: ProjectProfilePatchOperation[]
  projectId?: string | null
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
  proposalId?: string | null
}

export function ProjectProfilePatchCard({ proposalId, ...props }: ProjectProfilePatchCardProps) {
  return proposalId ? (
    <ProfilePatchReceipt
      proposalId={proposalId}
      title={props.title}
      rationale={props.rationale}
      patch={props.patch}
      projectId={props.projectId}
    />
  ) : (
    <BrowserAppliedProfileCard {...props} />
  )
}

function BrowserAppliedProfileCard({
  title,
  rationale,
  patch,
  projectId,
  messageId,
  cardKey,
  decisionsMustPersist,
}: Omit<ProjectProfilePatchCardProps, 'proposalId'>) {
  const t = useTranslations(chatCopy)
  const { decision, decide, canDecide } = useCardDecision(messageId, cardKey, {
    mustPersist: decisionsMustPersist,
  })
  const conversationId = useChatStore((state) => selectCardConversationId(state, messageId))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const profile = useCurrentProfile(projectId)

  const rows = useMemo(() => buildPatchPreviewRows(patch, profile), [patch, profile])

  const handleAccept = async () => {
    if (isSubmitting) return
    if (!projectId) {
      setError(t('profilePatchCard.noProject'))
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/profile/patches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversationId ? { patch, conversationId } : { patch }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `${t('profilePatchCard.applyFailed')} (${res.status})`)
      }
      setIsSubmitting(false)
      invalidateProjectFacts(projectId)
      decide('accepted')
    } catch (e) {
      setIsSubmitting(false)
      setError(e instanceof Error ? e.message : t('profilePatchCard.applyFailed'))
    }
  }

  const handleReject = () => {
    if (isSubmitting) return
    decide('rejected')
    setError(null)
  }

  if (decision === 'accepted') {
    return (
      <ProposalShell tone="accepted">
        <p className="text-sm text-foreground">{t('profilePatchCard.accepted')}</p>
      </ProposalShell>
    )
  }

  if (decision === 'rejected') {
    return (
      <ProposalShell tone="dismissed">
        <p className="text-sm text-muted-foreground">{t('profilePatchCard.rejected')}</p>
      </ProposalShell>
    )
  }

  return (
    <ProposalShell tone="pending">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{rationale}</p>

      <ProfilePatchTable rows={rows} showBefore={profile !== null} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* NOTHING TO PRESS when the answer could not be kept (`canDecide`): the
          proposed before/after still reads, because that is the substance of the
          card, but Accept would write the brief and then forget it had — and the
          next reader of this proposal would be offered the same write again. The
          question is put where the answer has a home, which is the thread. */}
      {canDecide && (
        <div className={DECISION_ROW}>
          {!projectId && (
            <p className="text-xs text-muted-foreground sm:mr-auto sm:min-w-[16rem] sm:flex-1">{t('profilePatchCard.noProject')}</p>
          )}
          {/* Without a project there is nothing to apply to: that one IS
              disabled, and says why beside it. In flight it is only busy —
              `disabled` dropped the reader's focus to <body> and the label
              swap changed the button's width; `aria-disabled` keeps the focus
              and `StackedLabel` keeps the width. */}
          <Button
            type="button"
            size="sm"
            onClick={handleAccept}
            disabled={!projectId}
            aria-disabled={isSubmitting || undefined}
            aria-busy={isSubmitting || undefined}
            className={cn(DECISION_BUTTON, 'aria-disabled:cursor-default')}
          >
            <StackedLabel
              busy={isSubmitting}
              idle={t('profilePatchCard.accept')}
              working={t('profilePatchCard.applying')}
            />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleReject}
            aria-disabled={isSubmitting || undefined}
            className={cn(DECISION_BUTTON, 'aria-disabled:cursor-default aria-disabled:opacity-50')}
          >
            {t('profilePatchCard.reject')}
          </Button>
        </div>
      )}
    </ProposalShell>
  )
}
