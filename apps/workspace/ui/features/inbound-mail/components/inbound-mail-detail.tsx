'use client'

import type { JSX, MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArchiveRestore, Loader2, Lock, Users, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Item, ItemList } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { useInView } from '@/hooks/use-in-view'
import { documentFilesHref } from '@/features/documents'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailPartView, InboundMailTextView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { CLAUSE_JOIN, formatCalendarDate } from '@/lib/format'
import { attachmentCase, notStagedSummary } from '../lib/attachment-case'
import type { InboundMailClient } from '../lib/client'
import {
  chooseFinding,
  decisionOf,
  draftSummary,
  initialDraft,
  updateAttachment,
  updateMessage,
  type DraftCopy,
  type FolderOption,
  type MailDraft,
} from '../lib/draft'
import { filedLines, type FiledLine } from '../lib/filed'
import { refusalNeedsReload, refusalOf, refusalTerms } from '../lib/refusal'
import { guardImpersonation, impersonationWarningOf } from '../lib/impersonation'
import { followOffered, mailClaimOf, senderDisplayName } from '../lib/sender'
import { missingSuggestionReason } from '../lib/suggestion'
import { AttachmentPreviewDialog } from './attachment-preview-dialog'
import { AttachmentRow } from './attachment-row'
import { ClaimedMailBar } from './claimed-mail-bar'
import { ContentFindingChoice } from './content-finding-choice'
import { DecisionBar } from './decision-bar'
import { FollowOffer } from './follow-offer'
import { ImpersonationWarning } from './impersonation-warning'
import { FactLine, QuietPanel } from './inbound-mail-atoms'
import { MailHeader } from './mail-header'
import { MailText, type MailTextState } from './mail-text'
import { MessageRow } from './message-row'
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
  const { locale } = useLocale()
  const router = useRouter()
  const [state, setState] = useState<ViewState>(initial ? { kind: 'ready', view: initial } : { kind: 'loading' })
  const [text, setText] = useState<MailTextState>(initialText ? { kind: 'ready', text: initialText } : { kind: 'loading' })
  const [draft, setDraft] = useState<MailDraft | null>(null)
  const [filing, setFiling] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [decidedByOther, setDecidedByOther] = useState(decidedByOtherInitially)
  const [threadNameStop, setThreadNameStop] = useState<string[] | null>(null)
  const [closedNoticeHidden, setClosedNoticeHidden] = useState(false)
  const [filingOpen, setFilingOpen] = useState(false)
  const [claimConfirmOpen, setClaimConfirmOpen] = useState(false)
  useEffect(() => {
    setFilingOpen(false)
    setClaimConfirmOpen(false)
  }, [mailId])
  const [preview, setPreview] = useState<string | null>(null)
  const [followTarget, setFollowTarget] = useState<{ threadId: string; name: string; followed: boolean } | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const copy: DraftCopy = useMemo(
    () => ({ unnamedAttachment: (position) => t('attachments.unnamed', { position }), untitledThread: t('row.noSubject') }),
    [t]
  )

  const view = useMemo(() => (state.kind === 'ready' ? guardImpersonation(state.view) : null), [state])

  const load = useCallback(async () => {
    try {
      const next = await client.get(projectId, mailId)
      if (alive.current) setState({ kind: 'ready', view: next })
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
    setFollowTarget(null)
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

  const ifMatch = view?.ifMatch
  useEffect(() => {
    if (view) setDraft(initialDraft(view, folders, copy))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- re-drafted on a new ifMatch only, never on an edit
  }, [view?.id, ifMatch, folders, copy])

  const messagePart = view?.parts.find((part) => part.kind === 'message')
  const messageDocumentId = messagePart?.state === 'filed' ? messagePart.documentId : null
  const offerFollow = !!view && followOffered(view) && !view.followedBy
  useEffect(() => {
    if (!messageDocumentId || !offerFollow) return
    let cancelled = false
    client
      .threadOfDocument(projectId, messageDocumentId)
      .then((thread) => {
        if (!cancelled && thread) setFollowTarget({ threadId: thread.id, name: thread.name, followed: thread.followed })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, projectId, messageDocumentId, offerFollow])

  const summary = view && draft ? draftSummary(view, draft) : null

  const follow = async (sent: InboundMailView, filedIds: string[]): Promise<void> => {
    let current = sent
    let delay = pollMs
    for (let round = 0; round < 40 && current.parts.some((part) => part.state === 'filing'); round += 1) {
      await sleep(delay)
      delay = Math.min(delay * 1.5, 5000)
      const next = await client.get(projectId, mailId).catch(() => null)
      if (!alive.current) return
      if (next) {
        current = next
        setState({ kind: 'ready', view: next })
      }
    }
    const byId = new Map(current.parts.map((part) => [part.id, part]))
    const landed = filedIds.map((id) => byId.get(id)).filter((part): part is InboundMailPartView => part?.state === 'filed')
    const files = landed.filter((part) => part.kind === 'attachment').length
    const text = landed.some((part) => part.kind === 'message')
    const firstDocument = landed.map((part) => part.documentId).find((id): id is string => !!id)
    if (landed.length > 0) {
      const lines = filedLines(current.parts, filedIds, t('suggestion.root'))
      toast.success(files > 0 && text ? t('toast.filedBoth', { count: files }) : files > 0 ? t('toast.filed', { count: files }) : t('toast.textFiled'), {
        description: lines.length > 0 ? <FiledLines lines={lines} /> : undefined,
        ...(firstDocument ? { action: { label: t('toast.view'), onClick: () => router.push(documentFilesHref(projectId, firstDocument)) } } : {}),
      })
    }
    onChanged()
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
      setState({ kind: 'ready', view: sent })
      await follow(sent, [...decision.parts.map((part) => part.partId), ...(decision.message ? [decision.message.partId] : [])])
    } catch (error) {
      const code = refusalOf(error)
      if (code === 'name_stop' && decision.message?.thread.action === 'create') setThreadNameStop(refusalTerms(error))
      toast.error(t(`refusals.${code}`))
      if (refusalNeedsReload(code)) {
        const next = await load()
        if (next && !next.parts.some((part) => part.state === 'waiting')) {
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
      toast.success(t('toast.restored'))
      onChanged()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
    } finally {
      if (alive.current) setRestoring(false)
    }
  }

  async function dismiss(): Promise<void> {
    if (!view || dismissing || filing) return
    setDismissing(true)
    try {
      const result = await client.dismiss(projectId, { mailIds: [view.id] })
      const next = result.mails.find((mail) => mail.id === view.id)
      if (next && alive.current) setState({ kind: 'ready', view: next })
      toast.success(t('toast.dismissed'), view.onlySenderReleases ? {} : { action: { label: t('toast.undo'), onClick: () => void restore() } })
      onChanged()
    } catch (error) {
      const code = refusalOf(error)
      toast.error(t(`refusals.${code}`))
      if (refusalNeedsReload(code)) void load()
    } finally {
      if (alive.current) setDismissing(false)
    }
  }

  const [choiceRef, choiceInView] = useInView<HTMLElement>({ rootMargin: '0px 0px -96px 0px' }) // the choice the foot's sentence repeats
  const attachments = useMemo(
    () => (view ? view.parts.filter((part) => part.kind === 'attachment').map((part) => attachmentCase(part, view)) : []),
    [view]
  )
  const previewable = attachments.find((entry) => entry.previewable && entry.part.state === 'waiting')

  if (actionsRef) {
    actionsRef.current = {
      file: () => void file(),
      dismiss: () => (view?.onlySenderReleases ? setClaimConfirmOpen(true) : void dismiss()),
      preview: () => previewable && setPreview(previewable.part.id),
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

  const missing = missingSuggestionReason(view, now)
  const notStaged = notStagedSummary(view.notStaged)
  const waitingParts = view.parts.filter((part) => part.state === 'waiting')
  const anyFiling = view.parts.some((part) => part.state === 'filing')
  const anyFiled = view.parts.some((part) => part.state === 'filed')
  const dismissedOrExpired = view.parts.filter((part) => part.state === 'dismissed' || part.state === 'expired')
  const restorableUntil = view.parts.map((part) => part.restorableUntil).find((until): until is string => !!until)
  const showBar = view.status === 'waiting' && waitingParts.length > 0 && !anyFiling && draft && summary
  const previewEntry = attachments.find((entry) => entry.part.id === preview)
  const outcome = filingOutcome(view)
  const impersonation = impersonationWarningOf(view)
  const claim = mailClaimOf(view)
  const readOnly = claim === 'colleague'
  const stopped = impersonation !== null && !filingOpen

  return (
    <article className="flex min-h-full flex-col" data-testid="inbound-mail-detail" data-mail-id={view.id}>
      {/* The section head's 32px, one right edge with it and the bar; on a phone the way back sits 4px under the title. */}
      {/* The subject on the list's filter line. On a desk the decision bar follows the content (sticky only once it
          overflows), not 180px below it at the pane's foot; on a phone it stays at the foot, under the thumb. */}
      {/* It grows at every width: the decision bar stands at the sheet's foot, not mid-sheet under a short mail. */}
      <div className="flex flex-1 flex-col gap-6 p-4 pt-1 sm:px-8 sm:pb-6 sm:pt-3">
        {back}
        {view.projectClosed && !closedNoticeHidden && (
          <Alert data-testid="detail-closed">
            <Lock aria-hidden className="text-warning" />
            <AlertTitle className="line-clamp-none">{t('closed.title')}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{t('closed.text')}</span>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('closed.dismiss')} onClick={() => setClosedNoticeHidden(true)}>
                <X className="size-4" aria-hidden />
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {decidedByOther && (
          <Alert variant="info" data-testid="detail-decided-by-other">
            <Users aria-hidden />
            <AlertTitle className="line-clamp-none">{t('state.decidedByOther')}</AlertTitle>
          </Alert>
        )}
        {outcome.quota ? (
          <Alert variant="destructive" data-testid="detail-quota">
            <AlertTriangle aria-hidden />
            <AlertTitle className="line-clamp-none">{t('state.quotaFull')}</AlertTitle>
          </Alert>
        ) : (
          outcome.failed > 0 && (
            <Alert data-testid="detail-partial-failure">
              <AlertTriangle aria-hidden className="text-warning" />
              <AlertTitle className="line-clamp-none">{outcome.failed === outcome.total
                  ? t('state.partialFailureAll', { failed: outcome.failed })
                  : t('state.partialFailure', { failed: outcome.failed, total: outcome.total })}</AlertTitle>
              <AlertDescription>{t('state.partialFailureHint')}</AlertDescription>
            </Alert>
          )
        )}
        {anyFiling && (
          <FactLine icon={Loader2} tone="default" className="[&>svg]:motion-safe:animate-spin" testId="detail-filing">
            {t('state.filing')}
          </FactLine>
        )}
        {waitingParts.length === 0 && dismissedOrExpired.length > 0 && restorableUntil && (
          <QuietPanel className="sm:flex-row sm:items-center sm:justify-between" data-testid="detail-restorable">
            <p className="text-sm">
              {/* A mail of which something was filed was not thrown away: say how many parts were, not „Verworfen“. */}
              {anyFiled
                ? t(dismissedOrExpired.some((part) => part.state === 'expired') ? 'state.partsExpired' : 'state.partsDismissed', {
                    count: dismissedOrExpired.length,
                    date: formatCalendarDate(restorableUntil, locale),
                  })
                : t(dismissedOrExpired.some((part) => part.state === 'expired') ? 'state.expired' : 'state.dismissed', {
                    date: formatCalendarDate(restorableUntil, locale),
                  })}
            </p>
            <BusyButton
              type="button"
              size="sm"
              variant="secondary"
              busy={restoring}
              busyLabel={t('state.restoreBusy')}
              icon={<ArchiveRestore aria-hidden />}
              onClick={() => void restore()}
              data-testid="detail-restore"
            >
              {t('state.restore')}
            </BusyButton>
          </QuietPanel>
        )}

        {/* Above the header, before anything can be checked: the owner's rule for a mail posing as someone. */}
        {impersonation && <ImpersonationWarning warning={impersonation} own={claim === 'own'} />}

        <MailHeader
          view={view}
          forwarded={text.kind === 'ready' ? text.text.forwardedFrom : null}
          originalUrl={client.originalUrl(projectId, view.id)}
          now={now}
        />
        <MailText state={text} onRetry={() => void loadText()} />

        {/* After the text, beside the choice it shapes: on a phone the mail itself is the first screen. */}
        {!stopped && !readOnly && messagePart?.state === 'waiting' && messagePart.contentFindings.length > 0 && draft?.message?.findingChoice && (
          <ContentFindingChoice
            findings={messagePart.contentFindings}
            value={draft.message.findingChoice}
            onChange={(choice) => setDraft((current) => (current ? chooseFinding(current, choice, view, folders, copy) : current))}
            disabled={filing}
          />
        )}

        {/* The forged mail's way to filing is one deliberate press, never the page's default. */}
        {impersonation && !readOnly && view.status === 'waiting' && waitingParts.length > 0 && (
          <div className="flex flex-col items-start gap-1">
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

        {!stopped && !readOnly && messagePart && draft?.message && (
          <section ref={choiceRef} className="flex flex-col gap-2" aria-label={t('message.label')}>
            <ItemList data-surface="sunken" className={DETAIL_PANEL}>
              <MessageRow
                projectId={projectId}
                view={view}
                draft={draft.message}
                folders={folders}
                copy={copy}
                threadNameStop={threadNameStop}
                onChange={(change) => setDraft((current) => (current ? updateMessage(current, change) : current))}
              />
            </ItemList>
          </section>
        )}

        {!stopped && (attachments.length > 0 || notStaged.listed.length > 0 || notStaged.layoutImages > 0) && draft && (
          <section className="flex flex-col gap-2" aria-label={t('attachments.label')}>
            <SectionLabel as="h3">{t('attachments.label')}</SectionLabel>
            {attachments.length > 0 && (
              <ItemList as="ul" data-surface="sunken" className={DETAIL_PANEL}>
                {attachments.map((entry) => {
                  const attachmentDraft = draft.attachments.find((candidate) => candidate.partId === entry.part.id)
                  if (!attachmentDraft) return null
                  return (
                    <AttachmentRow
                      key={entry.part.id}
                      projectId={projectId}
                      entry={entry}
                      draft={attachmentDraft}
                      folders={folders}
                      contentUrl={entry.previewable ? client.partContentUrl(projectId, view.id, entry.part.id) : null}
                      missingSuggestion={missing}
                      readOnly={readOnly}
                      onChange={(change) => setDraft((current) => (current ? updateAttachment(current, entry.part.id, change) : current))}
                      onPreview={entry.previewable ? () => setPreview(entry.part.id) : undefined}
                    />
                  )
                })}
              </ItemList>
            )}
            {(notStaged.listed.length > 0 || notStaged.layoutImages > 0) && (
              <ul className="text-muted-foreground flex flex-col gap-1 px-1 text-xs" data-testid="not-staged">
                {notStaged.listed.map((entry, index) => (
                  <li key={`${entry.filename}-${index}`} className="[overflow-wrap:anywhere]">
                    {t(`attachments.notStaged.${entry.reason}`, { name: entry.filename })}
                  </li>
                ))}
                {notStaged.layoutImages > 0 && <li>{t('attachments.notStaged.layoutImages', { count: notStaged.layoutImages })}</li>}
              </ul>
            )}
          </section>
        )}

        {messagePart?.state === 'filed' && offerFollow && followTarget && (
          <FollowOffer
            key={followTarget.threadId}
            threadName={followTarget.name}
            following={followTarget.followed}
            onFollow={async () => {
              try {
                await client.follow(projectId, followTarget.threadId)
                toast.success(t('follow.following', { name: followTarget.name }), {
                  action: {
                    label: t('follow.undo'),
                    onClick: () => {
                      void client.unfollow(projectId, followTarget.threadId).then(() => setFollowTarget({ ...followTarget, followed: false }))
                    },
                  },
                })
              } catch (error) {
                toast.error(t('follow.failed'))
                throw error
              }
            }}
          />
        )}
      </div>

      {showBar && readOnly && view.sender && (
        <ClaimedMailBar
          member={{ name: senderDisplayName(view.sender), address: view.sender.address }}
          impersonation={impersonation !== null}
          confirmOpen={claimConfirmOpen}
          onConfirmOpenChange={setClaimConfirmOpen}
          onDismiss={() => void dismiss()}
          dismissing={dismissing}
        />
      )}
      {showBar && !readOnly && (
        <DecisionBar
          summary={summary}
          acknowledgeSender={draft.acknowledgeSender}
          impersonation={impersonation !== null}
          filingOpen={filingOpen}
          onAcknowledgeSender={(value) => setDraft((current) => (current ? { ...current, acknowledgeSender: value } : current))}
          onFile={() => void file()}
          onDismiss={() => void dismiss()}
          filing={filing}
          dismissing={dismissing}
          yieldPrimary={yieldPrimary}
          choiceInView={choiceInView}
        />
      )}
      {previewEntry && (
        <AttachmentPreviewDialog
          open={preview !== null}
          onOpenChange={(open) => !open && setPreview(null)}
          name={previewEntry.part.filename ?? copy.unnamedAttachment(previewEntry.part.position)}
          contentType={previewEntry.part.contentType}
          url={previewEntry.previewable ? client.partContentUrl(projectId, view.id, previewEntry.part.id) : null}
        />
      )}
    </article>
  )
}

function FiledLines({ lines }: { lines: FiledLine[] }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <ul className="flex flex-col gap-0.5" data-testid="filed-lines">
      {lines.map((line, index) => (
        <li key={`${line.kind}-${index}`} className="[overflow-wrap:anywhere]">
          {line.kind === 'message' ? t('toast.lineText', { name: line.place.name }) : t('toast.lineFile', { name: line.place.name, folder: line.place.folder })}
          {line.place.version != null && `${CLAUSE_JOIN}${t('attachments.status.version', { version: line.place.version })}`}
        </li>
      ))}
    </ul>
  )
}

export function DetailSkeleton({ back }: { back?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-4 pt-1 sm:px-8 sm:pb-6 sm:pt-3" aria-busy="true" data-testid="inbound-mail-detail-loading">
      {back}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-9/12" />
      </div>
      {/* The attachments' own list, so the rows land where their skeletons stood. */}
      <ItemList data-surface="sunken" className={DETAIL_PANEL}>
        {[0, 1, 2].map((row) => (
          <Item key={row} className="px-4">
            <Skeleton className="size-4" />
            <Skeleton className="size-10 rounded-control" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </Item>
        ))}
      </ItemList>
    </div>
  )
}

const DETAIL_PANEL = '-mx-4 rounded-none border-0 divide-y-0 bg-transparent'
