'use client'

/**
 * Reviewing one change request (ADR-0165), in the order a reviewer works: what
 * this request is and where it stands (the step rail and one sentence saying
 * what to do now), then each record under its own name with each field in
 * words and its source one click away, then the one action that comes next,
 * at the bottom, disabled with its reason until it can run.
 *
 * Every claim is checked against its source: „Stimmt“ or „Stimmt nicht“, or
 * all of a record's at once. A request with a claim that is not correct cannot
 * be approved; it is rejected, and the proposer corrects it in a new one.
 * Approve, publish and rollback ask first: each is the person's own decision,
 * and the last two change what offices read.
 */

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Stepper } from '@/components/ui/stepper'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/adapters/auth/use-auth'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { MIN_OVERRIDE_REASON } from '@/lib/base-knowledge/platform/wire'
import type { ApprovalRole, ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import { ApprovalBadges } from './approval-badges'
import { ManifestationText } from './change-request-text'
import { SectionCard } from '@/features/platform/components/section-card'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { CaptureView, ChangeRequestView, RevisionView } from '@/lib/base-knowledge/platform/wire'
import { cn } from '@/lib/utils'
import {
  byReadingOrder,
  countryName,
  isKnownField,
  recordName,
  showValue,
  type ShownValue,
  type Wording,
} from './change-request-format'

const BASE = '/api/platform/knowledge/change-requests'

type Step = 'approve' | 'reject' | 'preview' | 'stable' | 'rollback' | 'alone' | 'confirm' | 'dispute'

/** Where a due second review is given, as the server has it (`decide.ts`). */
const REVIEWED_AFTER_APPROVAL: readonly ChangeRequestStatus[] = ['approved', 'published', 'rolled_back']
type Verdict = 'accepted' | 'rejected'

const KIND_WORDS = new Set([
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
  'statute',
  'union',
  'country',
  'state',
  'district',
  'municipality',
  'city_district',
])
const FUNCTION_WORDS = new Set(['building_permit', 'heritage', 'fire'])
const LICENCE_WORDS = new Set(['public_open', 'public_restricted', 'licensed'])

/** The route's own words for a refusal, or the status. */
async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? String(response.status)
}

function wordingFor(t: Translator, locale: string): Wording {
  return {
    locale,
    kindWord: (kind) => (KIND_WORDS.has(kind) ? t(`countryKnowledge.kinds.${kind}`) : null),
    functionWord: (code) => (FUNCTION_WORDS.has(code) ? t(`countryKnowledge.functions.${code}`) : null),
    licenceWord: (licence) => (LICENCE_WORDS.has(licence) ? t(`countryKnowledge.licences.${licence}`) : null),
  }
}

/** Where the request stands, as the rail's step and the sentence under it. */
function stageOf(view: ChangeRequestView, open: number, wrong: number): { index: number; say: string } {
  const previewed = view.releases.some((move) => move.channel === 'preview' && move.action === 'publish')
  if (view.status === 'submitted') return { index: open > 0 || wrong > 0 ? 0 : 1, say: wrong > 0 ? 'wrong' : open > 0 ? 'check' : 'approve' }
  if (view.status === 'approved') return { index: previewed ? 3 : 2, say: previewed ? 'stable' : 'preview' }
  if (view.status === 'published') return { index: 4, say: 'published' }
  return { index: -1, say: view.status }
}

function Value({ shown }: { shown: ShownValue }): JSX.Element {
  if (shown.kind === 'empty') return <span className="text-muted-foreground">–</span>
  const item = (entry: { text: string; code?: string }, key?: number) => (
    <span key={key} className="inline-flex items-baseline gap-1.5">
      <span>{entry.text}</span>
      {entry.code ? <span className="text-muted-foreground font-mono text-xs">{entry.code}</span> : null}
    </span>
  )
  if (shown.kind === 'text') return item(shown)
  return <span className="flex flex-wrap gap-x-3 gap-y-1">{shown.items.map((entry, index) => item(entry, index))}</span>
}

interface RecordProps {
  revision: RevisionView
  /** The request's captures by id: what each citation's quote is checked against. */
  captures: ReadonlyMap<string, CaptureView>
  canDecide: boolean
  busy: boolean
  /** `sourceChecked`: the reviewer compared a pasted (operator-supplied) page with its source. */
  onDecide: (claims: { path: string; decision: Verdict }[], sourceChecked?: boolean) => void
  /** The manifestation's text was uploaded or only named, not fetched from a source: accepting says it was compared too. */
  unfetchedText?: boolean
  /** A manifestation's text, shown beside its sources (`ManifestationText`). */
  children?: ReactNode
}

/** One citation as the reviewer checks it: the page, the quote taken from it, and whether nobody fetched it. */
function Source({ citation, capture }: { citation: RevisionView['citations'][number]; capture: CaptureView | undefined }): JSX.Element {
  const t = useTranslations(platformCopy)
  const href = citation.url ?? capture?.url
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-1 underline underline-offset-2">
          {citation.note ?? new URL(href).hostname}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : (
        <span className="text-foreground">{citation.note}</span>
      )}
      {citation.quote ? <q className="text-foreground">{citation.quote}</q> : null}
      {capture?.basis === 'operator_supplied' ? <Badge variant="outline">{t('countryKnowledge.operatorSupplied')}</Badge> : null}
    </span>
  )
}

function RecordCard({ revision, captures, canDecide, busy, onDecide, unfetchedText = false, children }: RecordProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const wording = useMemo(() => wordingFor(t, locale), [t, locale])
  const claims = byReadingOrder(revision.claims)
  const open = claims.filter((claim) => claim.decision !== 'accepted')
  const sources = revision.citations.filter((citation) => citation.url || citation.note || citation.captureId)
  // A page nobody fetched: accepting the record says the reviewer compared it with its source.
  const pastedPage = revision.citations.some((citation) => citation.captureId && captures.get(citation.captureId)?.basis === 'operator_supplied')
  // The same holds for a text a person uploaded: the verdict vouches for it (migration 0222).
  const pasted = pastedPage || unfetchedText
  return (
    <section className="flex flex-col gap-3 border-b pb-6 last:border-b-0" data-testid="change-request-record">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">{t(`countryKnowledge.recordTypes.${revision.type}`)}</span>
          <h3 className="text-base font-medium">{recordName(revision.claims, revision.recordId)}</h3>
        </div>
        {canDecide && open.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(open.map((claim) => ({ path: claim.path, decision: 'accepted' })), pasted)}
          >
            <Check aria-hidden />
            {pasted ? t('countryKnowledge.acceptChecked') : t('countryKnowledge.acceptAll')}
          </Button>
        ) : null}
      </div>
      {sources.length > 0 ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>{t('countryKnowledge.checkAgainst')}</span>
          {sources.map((citation, index) => (
            <Source key={index} citation={citation} capture={citation.captureId ? captures.get(citation.captureId) : undefined} />
          ))}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">{t('countryKnowledge.noSource')}</p>
      )}
      {pastedPage && canDecide ? <p className="text-muted-foreground text-sm">{t('countryKnowledge.pastedHint')}</p> : null}
      {unfetchedText && canDecide ? <p className="text-muted-foreground text-sm">{t('countryKnowledge.unfetchedTextHint')}</p> : null}
      {children}
      <dl className="flex flex-col">
        {claims.map((claim) => (
          <div
            key={claim.path}
            className="grid grid-cols-1 gap-x-4 gap-y-1 border-t py-2.5 sm:grid-cols-[11rem_1fr_auto] sm:items-center"
          >
            <dt className="text-muted-foreground text-sm">
              {isKnownField(claim.path) ? t(`countryKnowledge.fields.${claim.path}`) : claim.path}
            </dt>
            <dd className="text-sm break-words">
              <Value shown={showValue(claim.path, claim.value, wording)} />
            </dd>
            <dd className="flex items-center gap-1.5 sm:justify-end">
              {canDecide ? (
                (['accepted', 'rejected'] as const).map((decision) => (
                  <Button
                    key={decision}
                    size="sm"
                    variant={claim.decision === decision ? (decision === 'accepted' ? 'default' : 'destructive') : 'ghost'}
                    aria-pressed={claim.decision === decision}
                    disabled={busy}
                    onClick={() => onDecide([{ path: claim.path, decision }], pasted && decision === 'accepted')}
                  >
                    {decision === 'accepted' ? <Check aria-hidden /> : <X aria-hidden />}
                    {t(`countryKnowledge.verdicts.${decision}`)}
                  </Button>
                ))
              ) : claim.decision ? (
                <Badge variant={claim.decision === 'accepted' ? 'success' : 'destructive'}>
                  {claim.decision === 'accepted' ? <Check aria-hidden /> : <X aria-hidden />}
                  {t(`countryKnowledge.verdicts.${claim.decision}`)}
                </Badge>
              ) : (
                <span className="text-muted-foreground text-xs">{t('countryKnowledge.unchecked')}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function ChangeRequestReview({
  id,
  canManage,
  onChanged,
}: {
  id: string
  canManage: boolean
  onChanged: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const [view, setView] = useState<ChangeRequestView | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const { user } = useAuth()
  const canApproveAlone = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAlone)
  const canWrite = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeWrite)
  // Each second review is given in a role approved alone that the reviewer holds (ADR-0176).
  const holds: Record<ApprovalRole, boolean> = {
    domain_expert: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert),
    counsel: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsCounsel),
    privacy_reviewer: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeApproveAsPrivacyReviewer),
  }

  const load = useCallback(async () => {
    const response = await fetch(`${BASE}/${id}`).catch(() => null)
    if (!response || !response.ok) return setFailed(true)
    setFailed(false)
    setView((await response.json()) as ChangeRequestView)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const post = async (path: string, body: unknown, done: string | null): Promise<boolean> => {
    setBusy(true)
    try {
      const response = await fetch(`${BASE}/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        toast.error(t('countryKnowledge.failed', { reason: await refusal(response) }))
        return false
      }
      if (done) toast.success(done)
      await load()
      onChanged()
      return true
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  if (!view) return <SectionCard loading={!failed} error={failed} onRetry={() => void load()} />

  const claims = view.revisions.flatMap((revision) => revision.claims)
  const checked = claims.filter((claim) => claim.decision === 'accepted').length
  const wrong = claims.filter((claim) => claim.decision === 'rejected' || claim.decision === 'edited').length
  const open = claims.length - checked - wrong
  const stage = stageOf(view, open, wrong)
  // A request approved alone stays under review until another person gives its second review (ADR-0176).
  // Keyed off status as the server is: only an approved request (or later) takes its second review.
  const secondReviewDue = view.secondReview?.state === 'due' && REVIEWED_AFTER_APPROVAL.includes(view.status)
  const disputed = view.secondReview?.state === 'disputed'
  const authored = Boolean(user?.id) && view.revisions.some((revision) => revision.createdBy === user?.id)
  const dueRoles = (view.secondReviewRoles ?? []).filter((role) => role.state === 'due').map((role) => role.role)
  const reviewRole = dueRoles.find((role) => holds[role]) ?? null
  const canDecide = canManage && (view.status === 'submitted' || (secondReviewDue && !authored))
  const canReview = canManage && secondReviewDue && !authored && reviewRole !== null
  // The UI approves as domain expert; once that role is approved, alone or not, another override can only answer 409.
  const approvedAsExpert = view.approvals.some((approval) => approval.role === 'domain_expert')
  // A pasted page nobody else checked refuses an approval alone too (migration 0218): another person checks it first.
  const offerAlone = canManage && canApproveAlone && authored && view.status === 'submitted' && wrong === 0 && !approvedAsExpert && !view.sourcesUnchecked
  const decide = (revisionId: string) => (entries: { path: string; decision: Verdict }[], sourceChecked = false) =>
    void post(
      'review',
      { decisions: entries.map((entry) => ({ revisionId, claimPath: entry.path, decision: entry.decision, sourceChecked })) },
      null,
    )
  const captures = new Map((view.captures ?? []).map((capture) => [capture.captureId, capture]))
  const texts = new Map((view.texts ?? []).map((text) => [text.recordId, text]))

  const steps = (['check', 'approve', 'preview', 'stable'] as const).map((key) => ({
    key,
    label: t(`countryKnowledge.rail.${key}`),
  }))
  const primary: { step: Step; enabled: boolean; why?: string } | null = !canManage
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

  const run = (step: Step) => {
    if (step === 'alone') {
      return post('decision', { decision: 'approve', role: 'domain_expert', override: { reason: reason.trim() } }, t('countryKnowledge.done.alone'))
    }
    if (step === 'confirm') return post('decision', { decision: 'approve', role: reviewRole }, t('countryKnowledge.done.confirm'))
    if (step === 'dispute') return post('decision', { decision: 'reject', role: reviewRole }, t('countryKnowledge.done.dispute'))
    if (step === 'approve') return post('decision', { decision: 'approve', role: 'domain_expert' }, t('countryKnowledge.done.approve'))
    if (step === 'reject') return post('decision', { decision: 'reject', role: 'domain_expert' }, t('countryKnowledge.done.reject'))
    if (step === 'rollback') return post('rollback', { reason: t('countryKnowledge.rollbackReason') }, t('countryKnowledge.done.rollback'))
    return post('publish', { channel: step }, t(`countryKnowledge.done.${step}`))
  }

  return (
    <div className="flex min-h-0 flex-col" data-testid="change-request-panel">
      <DialogHeader className="gap-1">
        <DialogTitle>{view.title}</DialogTitle>
        <DialogDescription>
          {countryName(view.countryId, locale)} · {t(`countryKnowledge.status.${view.status}`)}
        </DialogDescription>
        <ApprovalBadges approval={view.approval} secondReview={view.secondReview} />
      </DialogHeader>

      {stage.index >= 0 ? (
        <div className="mt-5 flex flex-col gap-3">
          <Stepper
            steps={steps}
            current={stage.index}
            furthest={-1}
            onSelect={() => undefined}
            label={t('countryKnowledge.rail.label')}
            progressLabel={t('countryKnowledge.rail.progress', { current: Math.min(stage.index + 1, 4), total: 4 })}
          />
        </div>
      ) : null}

      <div className="bg-muted mt-5 flex flex-col gap-2 rounded-md p-4" data-testid="change-request-next">
        <p className="text-sm font-medium">
          {secondReviewDue
            ? t('countryKnowledge.secondReviewNext.due')
            : disputed
              ? t('countryKnowledge.secondReviewNext.disputed')
              : t(`countryKnowledge.next.${stage.say}`)}
        </p>
        {secondReviewDue && dueRoles.length > 0 ? (
          <p className="text-muted-foreground text-xs" data-testid="second-review-roles">
            {t('countryKnowledge.secondReviewDueIn', { roles: dueRoles.map((role) => t(`countryKnowledge.roles.${role}`)).join(', ') })}
          </p>
        ) : null}
        {view.status === 'submitted' || secondReviewDue ? (
          <>
            <Progress value={claims.length ? (checked / claims.length) * 100 : 0} aria-label={t('countryKnowledge.progressLabel')} />
            <p className="text-muted-foreground text-xs tabular-nums">
              {t('countryKnowledge.progress', { checked, total: claims.length })}
              {wrong > 0 ? ` · ${t('countryKnowledge.wrongCount', { count: wrong })}` : ''}
            </p>
          </>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {view.revisions.map((revision) => (
          <RecordCard
            key={revision.revisionId}
            revision={revision}
            captures={captures}
            canDecide={canDecide}
            busy={busy}
            onDecide={decide(revision.revisionId)}
            unfetchedText={revision.type === 'manifestation' && texts.has(revision.recordId) && texts.get(revision.recordId)?.origin !== 'url'}
          >
            {revision.type === 'manifestation' ? (
              <ManifestationText
                requestId={view.id}
                countryId={view.countryId}
                recordId={revision.recordId}
                text={texts.get(revision.recordId)}
                canAttach={canWrite && view.status === 'draft'}
                onAttached={() => void load()}
              />
            ) : null}
          </RecordCard>
        ))}
      </div>

      {primary || canReview ? (
        <div className="bg-card sticky -bottom-6 -mx-6 -mb-6 mt-6 flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4">
          {primary?.why ? <p className="text-muted-foreground mr-auto text-sm">{primary.why}</p> : null}
          {canReview ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming('dispute')} data-testid="second-review-dispute">
                {t('countryKnowledge.steps.dispute')}
              </Button>
              <Button
                variant={primary ? 'outline' : 'default'}
                disabled={busy || open > 0 || wrong > 0}
                onClick={() => setConfirming('confirm')}
                data-testid="second-review-confirm"
              >
                {t('countryKnowledge.steps.confirm')}
              </Button>
            </>
          ) : null}
          {view.status === 'submitted' && wrong > 0 ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirming('reject')}>
              {t('countryKnowledge.steps.reject')}
            </Button>
          ) : null}
          {primary ? (
            <Button
              variant={primary.step === 'rollback' ? 'outline' : 'default'}
              disabled={busy || !primary.enabled}
              onClick={() => setConfirming(primary.step)}
              className={cn(primary.step === 'rollback' && 'text-destructive')}
              data-testid={`change-request-step-${primary.step}`}
            >
              {t(`countryKnowledge.steps.${primary.step}`)}
            </Button>
          ) : null}
        </div>
      ) : null}

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
    </div>
  )
}
