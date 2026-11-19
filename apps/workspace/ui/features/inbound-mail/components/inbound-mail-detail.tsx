'use client'

import type { JSX, MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, Hourglass, Loader2, Lock, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ItemList } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { LoadError } from '@/components/ui/load-error'
import { documentFilesHref } from '@/features/documents'
import { useTranslations } from '@/i18n'
import type { InboundMailPartView, InboundMailTextView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { cn } from '@/lib/utils'
import { attachmentCase, notStagedSummary } from '../lib/attachment-case'
import type { InboundMailClient } from '../lib/client'
import { decisionOf, draftSummary, initialDraft, rebaseDraft, updateAttachment, updateMessage, type DraftCopy, type FolderOption, type MailDraft } from '../lib/draft'
import { attachmentOpenReason, FILING_STEPS, filingSteps, fileable, folderlessIds, openAttachmentIds, planLines, textNeedsDecision, type FilingStep } from '../lib/filing-plan'
import { filedLines } from '../lib/filed'
import { refusalNeedsReload, refusalOf, refusalTerms } from '../lib/refusal'
import { guardImpersonation, impersonationWarningOf } from '../lib/impersonation'
import { followOffered, mailClaimOf, senderDisplayName } from '../lib/sender'
import { mailStillSettling, missingSuggestionReason } from '../lib/suggestion'
import { AttachmentPreviewDialog, type PreviewItem } from './attachment-preview-dialog'
import { AttachmentLine, NotStagedList } from './attachment-line'
import { ClaimedMailBar } from './claimed-mail-bar'
import { DecisionBar } from './decision-bar'
import { DetailNotices, RestorablePanel, type Notice } from './detail-notices'
import { DETAIL_PANEL, DetailSkeleton } from './detail-skeleton'
import { FiledLines } from './filed-to'
import { FiledFollow } from './filed-follow'
import { ImpersonationWarning } from './impersonation-warning'
import { FilingDialog } from './filing-dialog'
import { FactLine, mailToast, useMailToastLift } from './inbound-mail-atoms'
import { MailHeader } from './mail-header'
import { MailText, type MailTextState } from './mail-text'
import { MessageFacts, MessageRow } from './message-row'
import { usePlanWords } from './plan-words'
import { useSettlingReads } from './use-settling-reads'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface DetailActions {
  file: () => void
  dismiss: () => void
  preview: () => void
}

type ViewState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; view: InboundMailView }

export function filingOutcome(view: InboundMailView): { failed: number; total: number; quota: boolean } {
  const attachments = view.parts.filter((part) => part.kind === 'attachment')
  const failed = attachments.filter((part) => part.state === 'waiting' && part.lastFailure !== null)
  const filed = attachments.filter((part) => part.state === 'filed')
  return { failed: failed.length, total: failed.length + filed.length, quota: failed.some((part) => part.lastFailure === 'quota') }
}

export interface InboundMailDetailProps {
  projectId: string
  mailId: string
  initial: InboundMailView | null
  initialText?: InboundMailTextView | null
  folders: readonly FolderOption[]
  client: InboundMailClient
  onChanged: () => void
  back?: ReactNode
  actionsRef?: MutableRefObject<DetailActions | null>
  now?: number
  pollMs?: number
  decidedByOther?: boolean
  yieldPrimary?: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const FILING_QUICK_ROUNDS = 40

export function InboundMailDetail({
  projectId,
  mailId,
  initial,
  initialText,
  folders,
  client,
  onChanged,
  back,
  actionsRef,
  now,
  pollMs = 1500,
  decidedByOther: decidedByOtherInitially = false,
  yieldPrimary = false,
}: InboundMailDetailProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const router = useRouter()
  const [state, setState] = useState<ViewState>(initial ? { kind: 'ready', view: initial } : { kind: 'loading' })
  const [text, setText] = useState<MailTextState>(initialText ? { kind: 'ready', text: initialText } : { kind: 'loading' })
  const [draft, setDraft] = useState<MailDraft | null>(null)
  const [filing, setFiling] = useState(false)
  const [slowFiling, setSlowFiling] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [decidedByOther, setDecidedByOther] = useState(decidedByOtherInitially)
  const [threadNameStop, setThreadNameStop] = useState<string[] | null>(null)
  const [closedNoticeHidden, setClosedNoticeHidden] = useState(false)
  const [filingOpen, setFilingOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreId = useId()
  const [claimConfirmOpen, setClaimConfirmOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [steps, setSteps] = useState<FilingStep[]>(['overview'])
  const [step, setStep] = useState<FilingStep>('overview')
  const [openIds, setOpenIds] = useState<string[]>([])
  const [pickIds, setPickIds] = useState<string[]>([])
  const [reviewed, setReviewed] = useState(false)
  const openButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setFilingOpen(false)
    setMoreOpen(false)
    setClaimConfirmOpen(false)
    setDialogOpen(false)
    setReviewed(false)
  }, [mailId])
  const [preview, setPreview] = useState<string | null>(null)
  const previewTrigger = useRef<HTMLElement | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const openMail = useRef(mailId)
  openMail.current = mailId
  const article = useRef<HTMLElement>(null)

  const words = usePlanWords()
  const copy: DraftCopy = useMemo(
    () => ({ unnamedAttachment: (position) => t('attachments.unnamed', { position }), untitledThread: t('row.noSubject') }),
    [t]
  )

  const view = useMemo(() => (state.kind === 'ready' ? guardImpersonation(state.view) : null), [state])

  const load = useCallback(async () => {
    try {
      const next = await client.get(projectId, mailId)
      if (alive.current && openMail.current === mailId) setState({ kind: 'ready', view: next })
      return next
    } catch {
      if (alive.current) setState((current) => (current.kind === 'ready' ? current : { kind: 'error' }))
      return null
    }
  }, [client, projectId, mailId])

  const loadText = useCallback(async () => {
    setText({ kind: 'loading' })
    try {
      const next = await client.text(projectId, mailId)
      if (alive.current) setText({ kind: 'ready', text: next })
    } catch {
      if (alive.current) setText({ kind: 'error' })
    }
  }, [client, projectId, mailId])

  useEffect(() => {
    setDecidedByOther(decidedByOtherInitially)
    setThreadNameStop(null)
    setSlowFiling(false)
    if (!initial || initial.id !== mailId) {
      setState({ kind: 'loading' })
      void load()
    } else {
      setState({ kind: 'ready', view: initial })
    }
    if (!initialText) void loadText()
    else setText({ kind: 'ready', text: initialText })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the mail, see above
  }, [mailId, load, loadText])

  const draftBase = useRef<MailDraft | null>(null)
  useEffect(() => {
    if (!view) return
    const fresh = initialDraft(view, folders, copy)
    const base = draftBase.current
    draftBase.current = fresh
    setDraft((current) => (current && base ? rebaseDraft(current, base, fresh) : fresh))
  }, [view, folders, copy])

  const messagePart = view?.parts.find((part) => part.kind === 'message')
  const messageDocumentId = messagePart?.state === 'filed' ? messagePart.documentId : null
  const offerFollow = !!view && followOffered(view) && !view.followedBy

  const anyFilingNow = !!view?.parts.some((part) => part.state === 'filing')
  const settling = !!view && !anyFilingNow && !filing && mailStillSettling(view, now)
  useSettlingReads({
    mailId,
    settling,
    view,
    pollMs,
    load,
    onDecidedElsewhere: () => {
      setDecidedByOther(true)
      onChanged()
    },
  })

  const summary = view && draft ? draftSummary(view, draft) : null

  const follow = async (sent: InboundMailView, filedIds: string[]): Promise<void> => {
    let current = sent
    let delay = pollMs
    for (let round = 0; current.parts.some((part) => part.state === 'filing'); round += 1) {
      await sleep(delay)
      if (!alive.current || openMail.current !== sent.id) return
      if (round + 1 === FILING_QUICK_ROUNDS) setSlowFiling(true)
      delay = round + 1 >= FILING_QUICK_ROUNDS ? pollMs * 10 : Math.min(delay * 1.5, pollMs * 4)
      const next = await client.get(projectId, mailId).catch(() => null)
      if (!alive.current || openMail.current !== sent.id) return
      if (next) {
        current = next
        setState({ kind: 'ready', view: next })
      }
    }
    setSlowFiling(false)
    const byId = new Map(current.parts.map((part) => [part.id, part]))
    const landed = filedIds.map((id) => byId.get(id)).filter((part): part is InboundMailPartView => part?.state === 'filed')
    const files = landed.filter((part) => part.kind === 'attachment').length
    const text = landed.some((part) => part.kind === 'message')
    const firstDocument = landed.map((part) => part.documentId).find((id): id is string => !!id)
    if (landed.length > 0) {
      const lines = filedLines(current.parts, filedIds, t('suggestion.root'))
      toast.success(
        files > 0 && text ? t('toast.filedBoth', { count: files }) : files > 0 ? t('toast.filed', { count: files }) : t('toast.textFiled'),
        mailToast({
          description: lines.length > 0 ? <FiledLines lines={lines} /> : undefined,
          ...(firstDocument ? { action: { label: t('toast.view'), onClick: () => router.push(documentFilesHref(projectId, firstDocument)) } } : {}),
        })
      )
    }
    onChanged()
  }

  const missing = view ? missingSuggestionReason(view, now) : 'none'

  const openFiling = (): void => {
    if (!view || !draft) return
    if (!reviewed) {
      const needed = filingSteps(view, draft, { missing })
      setSteps(needed)
      setOpenIds(openAttachmentIds(view, draft, missing))
      setPickIds(folderlessIds(view, draft, missing))
      setStep(needed[0])
    } else {
      setStep('overview')
    }
    setDialogOpen(true)
  }

  const goToStep = (next: FilingStep): void => {
    setStep(next)
    if (next === 'overview') setReviewed(true)
  }

  const addStep = (next: FilingStep): void => {
    setSteps((current) => FILING_STEPS.filter((candidate) => candidate === next || current.includes(candidate)))
    setStep(next)
  }

  const include = (partId: string): void => {
    if (!view || !draft) return
    if (draft.message?.partId === partId) {
      const next = updateMessage(draft, { checked: true })
      setDraft(next)
      if (textNeedsDecision(view, next)) addStep('text')
      return
    }
    const part = view.parts.find((candidate) => candidate.id === partId)
    const next = updateAttachment(draft, partId, { checked: true })
    const row = next.attachments.find((candidate) => candidate.partId === partId)
    setDraft(next)
    if (!part || !row || attachmentOpenReason(attachmentCase(part, view), row, missing) === null) return
    setOpenIds((ids) => (ids.includes(partId) ? ids : [...ids, partId]))
    if (row.folder === null && row.revisionOf === null) setPickIds((ids) => (ids.includes(partId) ? ids : [...ids, partId]))
    addStep('attachments')
  }

  const file = async (): Promise<void> => {
    if (!view || !draft || !summary || filing || dismissing || view.onlySenderReleases) return
    if (summary.files === 0 && !summary.text) return dismiss()
    if (summary.blockers.length > 0) return
    setFiling(true)
    const decision = decisionOf(view, draft)
    try {
      const result = await client.file(projectId, { mails: [decision] })
      const sent = result.mails.find((mail) => mail.id === view.id)
      if (!sent || !alive.current) return
      setDialogOpen(false)
      setState({ kind: 'ready', view: sent })
      await follow(sent, [...decision.parts.map((part) => part.partId), ...(decision.message ? [decision.message.partId] : [])])
    } catch (error) {
      const code = refusalOf(error)
      toast.error(t(`refusals.${code}`), mailToast())
      if (code === 'name_stop' && decision.message?.thread.action === 'create') {
        setThreadNameStop(refusalTerms(error))
        addStep('text')
      }
      if (refusalNeedsReload(code)) {
        const next = await load()
        if (next && !next.parts.some((part) => part.state === 'waiting')) {
          setDialogOpen(false)
          setDecidedByOther(true)
          onChanged()
        }
      }
    } finally {
      if (alive.current) setFiling(false)
    }
  }

  const restore = async (): Promise<void> => {
    setRestoring(true)
    try {
      const next = await client.restore(projectId, mailId)
      if (alive.current) setState({ kind: 'ready', view: next })
      toast.success(t('toast.restored'), mailToast())
      onChanged()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`), mailToast())
    } finally {
      if (alive.current) setRestoring(false)
    }
  }

  async function dismiss(): Promise<void> {
    if (!view || dismissing || filing) return
    setDismissing(true)
    setDialogOpen(false)
    try {
      const result = await client.dismiss(projectId, { mailIds: [view.id] })
      const next = result.mails.find((mail) => mail.id === view.id)
      if (next && alive.current) setState({ kind: 'ready', view: next })
      toast.success(t('toast.dismissed'), mailToast(!view.onlySenderReleases ? { action: { label: t('toast.undo'), onClick: () => void restore() } } : {}))
      onChanged()
    } catch (error) {
      const code = refusalOf(error)
      toast.error(t(`refusals.${code}`), mailToast())
      if (refusalNeedsReload(code)) void load()
    } finally {
      if (alive.current) setDismissing(false)
    }
  }

  const attachments = useMemo(
    () => (view ? view.parts.filter((part) => part.kind === 'attachment').map((part) => attachmentCase(part, view)) : []),
    [view]
  )
  const previewItems: PreviewItem[] = useMemo(
    () =>
      view
        ? attachments
            .filter((entry) => entry.previewable)
            .map((entry) => ({
              id: entry.part.id,
              name: entry.part.filename ?? copy.unnamedAttachment(entry.part.position),
              contentType: entry.part.contentType,
              url: client.partContentUrl(projectId, view.id, entry.part.id) || null,
            }))
            .filter((item) => item.url !== null)
        : [],
    [attachments, client, copy, projectId, view]
  )

  useMailToastLift(article, `${state.kind}:${view?.status}:${view?.parts.map((part) => part.state).join()}`)

  const impersonationNow = view ? impersonationWarningOf(view) !== null : false
  const offersFiling = !!view && !!draft && view.status === 'waiting' && fileable(view) && (!impersonationNow || filingOpen)

  if (actionsRef) {
    actionsRef.current = {
      file: () => {
        if (offersFiling && !filing && !dismissing) openFiling()
      },
      dismiss: () => (view?.onlySenderReleases ? setClaimConfirmOpen(true) : void dismiss()),
      preview: () => {
        if (previewItems.length === 0) return
        previewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setPreview(previewItems[0].id)
      },
    }
  }

  if (state.kind === 'loading') return <DetailSkeleton back={back} />
  if (state.kind === 'error' || !view) {
    return (
      <div className="flex flex-col gap-4 p-4 pt-1 sm:px-8 sm:pb-6 sm:pt-3">
        {back}
        <LoadError title={t('detailLoadError')} onRetry={() => load()} />
      </div>
    )
  }

  const notStaged = notStagedSummary(view.notStaged)
  const waitingParts = view.parts.filter((part) => part.state === 'waiting')
  const anyFiling = anyFilingNow
  const showBar = view.status === 'waiting' && waitingParts.length > 0 && !anyFiling && draft && summary
  const outcome = filingOutcome(view)
  const impersonation = impersonationWarningOf(view)
  const claim = mailClaimOf(view)
  const readOnly = claim === 'colleague'
  const stopped = impersonation !== null && !filingOpen
  const closedShown = view.projectClosed && !closedNoticeHidden

  const notices: Notice[] = []
  if (closedShown) {
    notices.push({ key: 'closed', icon: Lock, iconClass: 'text-warning', title: t('closed.title'), text: t('closed.text'), testId: 'detail-closed', onHide: () => setClosedNoticeHidden(true) })
  }
  if (decidedByOther) notices.push({ key: 'decided', icon: Users, iconClass: 'text-muted-foreground', title: t('state.decidedByOther'), testId: 'detail-decided-by-other' })
  if (outcome.quota) {
    notices.push({ key: 'quota', icon: AlertTriangle, iconClass: 'text-error', title: t('state.quotaFull'), testId: 'detail-quota', danger: true })
  } else if (outcome.failed > 0) {
    notices.push({
      key: 'failed',
      icon: AlertTriangle,
      iconClass: 'text-warning',
      title: outcome.failed === outcome.total ? t('state.partialFailureAll', { failed: outcome.failed }) : t('state.partialFailure', { failed: outcome.failed, total: outcome.total }),
      text: t('state.partialFailureHint'),
      testId: 'detail-partial-failure',
    })
  }

  const lines = draft ? planLines(view, draft, copy) : []
  const phraseOf = (partId: string): string | null => {
    const entry = attachments.find((candidate) => candidate.part.id === partId)
    const line = lines.find((candidate) => candidate.partId === partId)
    const row = draft?.attachments.find((candidate) => candidate.partId === partId)
    if (!entry || !line || !row || readOnly || entry.part.state !== 'waiting') return null
    return words.phrase(line, reviewed ? null : attachmentOpenReason(entry, row, missing), entry.part)
  }
  const questions = draft ? filingSteps(view, draft, { missing }).length - 1 : 0

  return (
    <article ref={article} className="flex min-h-full flex-col" data-testid="inbound-mail-detail" data-mail-id={view.id}>
      {/* The section head's 32px, one right edge with it and the bar; on a phone the way back sits 4px under the title. */}
      {/* It grows at every width: the decision bar stands at the sheet's foot, not mid-sheet under a short mail. */}
      <div className="flex flex-1 flex-col gap-6 p-4 pt-1 sm:px-8 sm:pb-6 sm:pt-3">
        {back}
        <DetailNotices notices={notices} />
        {anyFiling && (
          <FactLine icon={slowFiling ? Hourglass : Loader2} tone="default" className={cn(!slowFiling && '[&>svg]:motion-safe:animate-spin')} testId="detail-filing">
            {slowFiling ? t('state.filingSlow') : t('state.filing')}
          </FactLine>
        )}
        {waitingParts.length === 0 && <RestorablePanel parts={view.parts} restoring={restoring} onRestore={() => void restore()} />}

        {/* Above the header, before anything can be checked: the owner's rule for a mail posing as someone. */}
        {impersonation && (
          <ImpersonationWarning
            warning={impersonation}
            own={claim === 'own'}
            report={
              showBar && !dismissing && !filing
                ? {
                    projectId,
                    mailId: view.id,
                    client,
                    onReported: (next) => {
                      if (alive.current) setState({ kind: 'ready', view: next })
                      onChanged()
                    },
                    onRefused: (code) => void (refusalNeedsReload(code) && load()),
                  }
                : null
            }
          />
        )}

        <MailHeader
          view={view}
          forwarded={text.kind === 'ready' ? text.text.forwardedFrom : null}
          originalUrl={client.originalUrl(projectId, view.id)}
          now={now}
        />
        <MailText state={text} onRetry={() => void loadText()} />
        {messagePart?.state === 'waiting' && <MessageFacts view={view} />}

        {/* The forged mail's way to filing is one deliberate press, never the page's default. */}
        {impersonation && !readOnly && view.status === 'waiting' && waitingParts.length > 0 && (
          <div className="flex flex-col items-start gap-2" data-testid="impersonation-more">
            <Button
              type="button"
              variant="inline"
              className="text-muted-foreground touch-target h-auto gap-1 p-0 text-xs"
              aria-expanded={moreOpen || filingOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen((open) => !open)}
              disabled={filingOpen}
              data-testid="impersonation-more-toggle"
            >
              {t('impersonationWarning.more')}
              <ChevronDown className={cn('size-3.5 transition-transform duration-quick motion-reduce:transition-none', (moreOpen || filingOpen) && 'rotate-180')} aria-hidden />
            </Button>
            {(moreOpen || filingOpen) && (
              <div id={moreId} className="flex flex-col items-start gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-expanded={filingOpen}
                  onClick={() => setFilingOpen((open) => !open)}
                  data-testid="impersonation-file-anyway"
                >
                  {t(filingOpen ? 'impersonationWarning.fileAnywayClose' : 'impersonationWarning.fileAnyway')}
                </Button>
                <p className="text-muted-foreground text-xs">{t(claim === 'own' ? 'impersonationWarning.fileAnywayHintOwn' : 'impersonationWarning.fileAnywayHint')}</p>
              </div>
            )}
          </div>
        )}

        {messagePart && messagePart.state !== 'waiting' && draft?.message && (
          <section className="flex flex-col gap-2" aria-label={t('message.label')}>
            <ItemList data-surface="sunken" className={DETAIL_PANEL}>
              <MessageRow projectId={projectId} view={view} draft={draft.message} folders={folders} copy={copy} threadNameStop={null} onChange={() => undefined} />
            </ItemList>
          </section>
        )}

        {!stopped && (attachments.length > 0 || notStaged.listed.length > 0 || notStaged.layoutImages > 0) && draft && (
          <section className="flex flex-col gap-2" aria-label={t('attachments.label')}>
            <SectionLabel as="h3">{t('attachments.label')}</SectionLabel>
            {attachments.length > 0 && (
              <ItemList as="ul" data-surface="sunken" className={DETAIL_PANEL} data-testid="attachments-list">
                {attachments.map((entry) => {
                  const url = entry.previewable ? client.partContentUrl(projectId, view.id, entry.part.id) : null
                  return (
                    <AttachmentLine
                      key={entry.part.id}
                      projectId={projectId}
                      entry={entry}
                      name={entry.part.filedAs?.name ?? entry.part.filename ?? copy.unnamedAttachment(entry.part.position)}
                      phrase={phraseOf(entry.part.id)}
                      contentUrl={url}
                      onPreview={
                        url
                          ? (trigger) => {
                              previewTrigger.current = trigger
                              setPreview(entry.part.id)
                            }
                          : undefined
                      }
                    />
                  )
                })}
              </ItemList>
            )}
            <NotStagedList notStaged={notStaged} originalHeld={view.originalHeld} />
          </section>
        )}

        {offerFollow && messageDocumentId && <FiledFollow key={messageDocumentId} projectId={projectId} client={client} documentId={messageDocumentId} />}
      </div>

      {showBar && readOnly && view.sender && (
        <ClaimedMailBar
          member={{ name: senderDisplayName(view.sender), address: view.sender.address }}
          confirmOpen={claimConfirmOpen}
          onConfirmOpenChange={setClaimConfirmOpen}
          onDismiss={() => void dismiss()}
          dismissing={dismissing}
        />
      )}
      {showBar && !readOnly && (
        <DecisionBar
          offersFiling={offersFiling}
          questions={questions}
          impersonation={impersonation !== null}
          reportOffered={impersonation !== null && !dismissing && !filing}
          onOpenFiling={openFiling}
          onDismiss={() => void dismiss()}
          filing={filing}
          dismissing={dismissing}
          yieldPrimary={yieldPrimary}
          openRef={openButton}
        />
      )}
      {offersFiling && draft && summary && (
        <FilingDialog
          open={dialogOpen && !!showBar}
          onOpenChange={setDialogOpen}
          steps={steps}
          step={step}
          onStep={goToStep}
          onAddStep={addStep}
          projectId={projectId}
          view={view}
          draft={draft}
          onDraft={(update) => setDraft((current) => (current ? update(current) : current))}
          summary={summary}
          folders={folders}
          copy={copy}
          missing={missing}
          openIds={openIds}
          pickIds={pickIds}
          threadNameStop={threadNameStop}
          onInclude={include}
          impersonation={impersonation !== null}
          contentUrlOf={(partId) => client.partContentUrl(projectId, view.id, partId) || null}
          onPreview={(partId, trigger) => {
            previewTrigger.current = trigger
            setPreview(partId)
          }}
          filing={filing}
          onFile={() => void file()}
          onDismiss={() => void dismiss()}
          returnFocusRef={openButton}
        />
      )}
      {previewItems.length > 0 && (
        <AttachmentPreviewDialog
          open={preview !== null}
          onOpenChange={(open) => !open && setPreview(null)}
          items={previewItems}
          currentId={preview}
          onCurrentChange={setPreview}
          returnFocusRef={previewTrigger}
        />
      )}
    </article>
  )
}
