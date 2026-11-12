'use client'

/**
 * The next step of one change request once its claims are decided (ADR-0165,
 * ADR-0176): approve, approve alone, give or dispute a due second review,
 * publish to preview, then to stable, roll back. Each asks first, and each is
 * the person's own decision on the existing decide, publish and rollback
 * routes; four eyes stays the server's. The review dialog and the law map's
 * outline both end with it, so a request is released the same way from either.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/adapters/auth/use-auth'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { MIN_OVERRIDE_REASON } from '@/lib/base-knowledge/platform/wire'
import type { ChangeRequestView } from '@/lib/base-knowledge/platform/wire'
import type { ApprovalRole, ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'

const BASE = '/api/platform/knowledge/change-requests'

export type ReleaseStep = 'approve' | 'reject' | 'preview' | 'stable' | 'rollback' | 'alone' | 'confirm' | 'dispute'

/** Where a due second review is given, as the server has it (`decide.ts`). */
export const REVIEWED_AFTER_APPROVAL: readonly ChangeRequestStatus[] = ['approved', 'published', 'rolled_back']

/** The route's own words for a refusal, or the status. */
export async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null
  return body?.error ?? body?.detail ?? String(response.status)
}

/** Where the request stands, as the rail's step and the sentence under it. */
export function stageOf(view: ChangeRequestView, open: number, wrong: number): { index: number; say: string } {
  const previewed = view.releases.some((move) => move.channel === 'preview' && move.action === 'publish')
  if (view.status === 'submitted') return { index: open > 0 || wrong > 0 ? 0 : 1, say: wrong > 0 ? 'wrong' : open > 0 ? 'check' : 'approve' }
  if (view.status === 'approved') return { index: previewed ? 3 : 2, say: previewed ? 'stable' : 'preview' }
  if (view.status === 'published') return { index: 4, say: 'published' }
  return { index: -1, say: view.status }
}

/** Open, accepted and wrong claims of the request: what decides whether it may be approved. */
export function claimCounts(view: ChangeRequestView): { total: number; checked: number; wrong: number; open: number } {
  const claims = view.revisions.flatMap((revision) => revision.claims)
  const checked = claims.filter((claim) => claim.decision === 'accepted').length
  const wrong = claims.filter((claim) => claim.decision === 'rejected' || claim.decision === 'edited').length
  return { total: claims.length, checked, wrong, open: claims.length - checked - wrong }
}

export function ReleaseBar({ view, canManage, onChanged, className }: { view: ChangeRequestView; canManage: boolean; onChanged: () => void; className?: string }): JSX.Element | null {
  const t = useTranslations(platformCopy)
  const [confirming, setConfirming] = useState<ReleaseStep | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const { user } = useAuth()
  const canApproveAlone = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAlone)
  // Each second review is given in a role approved alone that the reviewer holds (ADR-0176).
  const holds: Record<ApprovalRole, boolean> = {
    domain_expert: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert),
    counsel: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsCounsel),
    privacy_reviewer: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsPrivacyReviewer),
  }

  const { open, wrong } = claimCounts(view)
  const stage = stageOf(view, open, wrong)
  // Keyed off status as the server is: only an approved request (or later) takes its second review.
  const secondReviewDue = view.secondReview?.state === 'due' && REVIEWED_AFTER_APPROVAL.includes(view.status)
  const disputed = view.secondReview?.state === 'disputed'
  const authored = Boolean(user?.id) && view.revisions.some((revision) => revision.createdBy === user?.id)
  const dueRoles = (view.secondReviewRoles ?? []).filter((role) => role.state === 'due').map((role) => role.role)
  const reviewRole = dueRoles.find((role) => holds[role]) ?? null
  const canReview = canManage && secondReviewDue && !authored && reviewRole !== null
  // The UI approves as domain expert; once that role is approved, alone or not, another override can only answer 409.
  const approvedAsExpert = view.approvals.some((approval) => approval.role === 'domain_expert')
  // A pasted page nobody else checked refuses an approval alone too (migration 0218): another person checks it first.
  const offerAlone = canManage && canApproveAlone && authored && view.status === 'submitted' && wrong === 0 && !approvedAsExpert && !view.sourcesUnchecked

  const primary: { step: ReleaseStep; enabled: boolean; why?: string } | null = !canManage
    ? null
    : view.status === 'submitted' && offerAlone
      ? { step: 'alone', enabled: true, why: t('countryKnowledge.why.alone') }
      : view.status === 'submitted'
        ? {
            step: 'approve',
            // An author's plain approve can only be refused (four eyes): another person approves, or checks the pasted page first.
            enabled: open === 0 && wrong === 0 && !authored,
            why:
              wrong > 0
                ? t('countryKnowledge.why.wrong', { count: wrong })
                : authored
                  ? t(view.sourcesUnchecked ? 'countryKnowledge.why.ownUnchecked' : 'countryKnowledge.why.own')
                  : open > 0
                    ? t('countryKnowledge.why.open', { count: open })
                    : undefined,
          }
        : view.status === 'approved' && disputed
          ? { step: 'reject', enabled: true }
          : view.status === 'approved'
            ? { step: stage.index === 3 ? 'stable' : 'preview', enabled: true }
            : view.status === 'published'
              ? { step: 'rollback', enabled: true }
              : null

  const post = async (path: string, body: unknown, done: string): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(`${BASE}/${view.id}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        toast.error(t('countryKnowledge.failed', { reason: await refusal(response) }))
        return
      }
      toast.success(done)
      onChanged()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const run = (step: ReleaseStep): Promise<void> => {
    if (step === 'alone') return post('decision', { decision: 'approve', role: 'domain_expert', override: { reason: reason.trim() } }, t('countryKnowledge.done.alone'))
    if (step === 'confirm') return post('decision', { decision: 'approve', role: reviewRole }, t('countryKnowledge.done.confirm'))
    if (step === 'dispute') return post('decision', { decision: 'reject', role: reviewRole }, t('countryKnowledge.done.dispute'))
    if (step === 'approve') return post('decision', { decision: 'approve', role: 'domain_expert' }, t('countryKnowledge.done.approve'))
    if (step === 'reject') return post('decision', { decision: 'reject', role: 'domain_expert' }, t('countryKnowledge.done.reject'))
    if (step === 'rollback') return post('rollback', { reason: t('countryKnowledge.rollbackReason') }, t('countryKnowledge.done.rollback'))
    return post('publish', { channel: step }, t(`countryKnowledge.done.${step}`))
  }

  if (!primary && !canReview) return null
  return (
    <>
      <div className={cn('flex flex-wrap items-center justify-end gap-3', className)} data-testid="release-bar">
        {primary?.why ? <p className="text-muted-foreground mr-auto text-sm">{primary.why}</p> : null}
        {canReview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming('dispute')} data-testid="second-review-dispute">
              {t('countryKnowledge.steps.dispute')}
            </Button>
            <Button variant={primary ? 'secondary' : 'default'} disabled={busy || open > 0 || wrong > 0} onClick={() => setConfirming('confirm')} data-testid="second-review-confirm">
              {t('countryKnowledge.steps.confirm')}
            </Button>
          </>
        ) : null}
        {view.status === 'submitted' && wrong > 0 ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming('reject')}>
            {t('countryKnowledge.steps.reject')}
          </Button>
        ) : null}
        {primary ? (
          <Button
            variant={primary.step === 'rollback' ? 'secondary' : 'default'}
            disabled={busy || !primary.enabled}
            onClick={() => setConfirming(primary.step)}
            className={cn(primary.step === 'rollback' && 'text-destructive')}
            data-testid={`change-request-step-${primary.step}`}
          >
            {t(`countryKnowledge.steps.${primary.step}`)}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(isOpen) => (isOpen ? null : setConfirming(null))}
        title={confirming ? t(`countryKnowledge.confirm.${confirming}.title`) : ''}
        description={confirming ? t(`countryKnowledge.confirm.${confirming}.body`) : ''}
        confirmLabel={confirming ? t(`countryKnowledge.steps.${confirming}`) : ''}
        cancelLabel={t('countryKnowledge.cancel')}
        tone={['rollback', 'stable', 'reject', 'alone', 'dispute'].includes(confirming ?? '') ? 'warning' : 'default'}
        confirmDisabled={confirming === 'alone' && reason.trim().length < MIN_OVERRIDE_REASON}
        onConfirm={() => (confirming ? void run(confirming) : undefined)}
      >
        {confirming === 'alone' ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t('countryKnowledge.aloneReason')}</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} data-testid="approve-alone-reason" />
            <span className="text-muted-foreground text-xs">{t('countryKnowledge.aloneReasonHint')}</span>
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
