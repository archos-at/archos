'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useMemoryKindLabels } from '@/components/memory/memory-kinds'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/store'
import { useCardDecision } from '../hooks/use-card-decision'
import { MemoryReceipt } from './ProposalReceipts'
import { DECISION_BUTTON, DECISION_ROW } from './card-chrome'
import { ProposalShell } from './ProposalShell'
import { StackedLabel } from '@/components/ui/stacked-label'

type MemoryKind = 'decision' | 'constraint' | 'open_question' | 'derived_fact' | 'preference'
type MemoryConfidence = 'low' | 'medium' | 'high'

interface MemoryProposalCardProps {
  title: string
  content: string
  kind: MemoryKind
  confidence?: MemoryConfidence
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
  supersedes?: string | null
  topic?: string | null
  proposalId?: string | null
}

export function MemoryProposalCard({ proposalId, ...props }: MemoryProposalCardProps) {
  return proposalId ? (
    <MemoryReceipt
      proposalId={proposalId}
      title={props.title}
      content={props.content}
      kind={props.kind}
      confidence={props.confidence ?? 'medium'}
      supersedes={props.supersedes}
    />
  ) : (
    <BrowserWrittenMemoryCard {...props} />
  )
}

function BrowserWrittenMemoryCard({
  title,
  content,
  kind,
  confidence = 'medium',
  topic,
  messageId,
  cardKey,
  decisionsMustPersist,
}: Omit<MemoryProposalCardProps, 'proposalId' | 'supersedes'>) {
  const t = useTranslations(chatCopy)
  const kindLabels = useMemoryKindLabels()
  const projectId = useChatStore((s) => s.projectId)
  const temporary = useChatStore((s) => s.currentConversation?.temporary === true)
  const { decision, decide, canDecide } = useCardDecision(messageId, cardKey, {
    mustPersist: decisionsMustPersist,
  })
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [savingTo, setSavingTo] = useState<'org' | 'project'>('org')

  const save = async (url: string, savedDecision: 'savedOrg' | 'savedProject') => {
    if (isSubmitting) return
    if (temporary) {
      setError(t('memoryProposal.temporaryConversation'))
      return
    }
    setError(null)
    setSavingTo(savedDecision === 'savedProject' ? 'project' : 'org')
    setIsSubmitting(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, content, confidence, ...(topic ? { topic } : {}) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `${t('memoryProposal.error')} (${res.status})`)
      }
      setIsSubmitting(false)
      decide(savedDecision)
    } catch (e) {
      setIsSubmitting(false)
      setError(e instanceof Error ? e.message : t('memoryProposal.error'))
    }
  }

  const handleSaveOrg = () => save('/api/organization/memory', 'savedOrg')
  const handleSaveProject = () => {
    if (!projectId) return
    void save(`/api/projects/${projectId}/memory`, 'savedProject')
  }
  const handleDismiss = () => {
    if (isSubmitting) return
    decide('dismissed')
    setError(null)
  }

  if (decision === 'savedOrg' || decision === 'savedProject') {
    return (
      <ProposalShell tone="accepted">
        <p className="text-sm text-foreground">
          {decision === 'savedOrg' ? t('memoryProposal.savedOrg') : t('memoryProposal.savedProject')}
        </p>
      </ProposalShell>
    )
  }

  if (decision === 'dismissed') {
    return (
      <ProposalShell tone="dismissed">
        <p className="text-sm text-muted-foreground">{t('memoryProposal.dismissed')}</p>
      </ProposalShell>
    )
  }

  return (
    <ProposalShell tone="pending">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <Chip variant="muted" size="sm">
          {kindLabels.kind(kind)}
        </Chip>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{content}</p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* NOTHING TO PRESS when the answer could not be kept (`canDecide`): the
          proposal still reads — this is what the run wants remembered — but a
          Yes here would write the note and then forget it had. The write
          de-duplicates (`createProjectMemoryItem` refreshes an existing note
          instead of adding a second), so a repeat is not a second row, but the
          card would still ask again after a reload. It is asked again where
          the answer has a home, which is the thread. */}
      {canDecide && (
        <>
          {/* BUSY, NOT DISABLED, while a save is in flight. `disabled` on the
              button the reader just pressed dropped their focus to <body> and
              dimmed the whole row; `aria-disabled` keeps the focus where it
              is, the handlers ignore a second press, and the pressed button
              says what it is doing in a label slot as wide as either label
              (`StackedLabel`), so nothing beside it moves.

              One decision row (card-chrome `DECISION_ROW`): the org-wide Yes
              first, then the project-only way in when a project is in scope,
              then No. */}
          <div className={DECISION_ROW}>
            <p className="text-sm text-muted-foreground sm:mr-auto">{t('memoryProposal.prompt')}</p>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveOrg}
              aria-disabled={isSubmitting || undefined}
              aria-busy={(isSubmitting && savingTo === 'org') || undefined}
              className={cn(DECISION_BUTTON, 'aria-disabled:cursor-default')}
            >
              <StackedLabel
                busy={isSubmitting && savingTo === 'org'}
                idle={t('memoryProposal.yes')}
                working={t('memoryProposal.saving')}
              />
            </Button>
            {projectId && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSaveProject}
                aria-disabled={isSubmitting || undefined}
                aria-busy={(isSubmitting && savingTo === 'project') || undefined}
                className={cn(DECISION_BUTTON, 'aria-disabled:cursor-default')}
              >
                <StackedLabel
                  busy={isSubmitting && savingTo === 'project'}
                  idle={t('memoryProposal.saveToProject')}
                  working={t('memoryProposal.saving')}
                />
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDismiss}
              aria-disabled={isSubmitting || undefined}
              className={cn(DECISION_BUTTON, 'aria-disabled:cursor-default aria-disabled:opacity-50')}
            >
              {t('memoryProposal.no')}
            </Button>
          </div>
        </>
      )}
    </ProposalShell>
  )
}
