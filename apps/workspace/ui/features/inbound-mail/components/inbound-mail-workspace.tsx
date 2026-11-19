'use client'

import { CLAUSE_JOIN } from '@/lib/format'
import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Lock, MailPlus, MailSearch, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProjectSectionActions, ProjectSectionBack, useSectionBackSlot } from '@/components/shell/project-section-frame'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTranslations } from '@/i18n'
import {
  INBOUND_MAIL_DECISION_MAX_MAILS,
  INBOUND_MAIL_LIST_LIMIT,
  type InboundMailListStatus,
  type InboundMailListView,
  type InboundMailSummaryView,
  type InboundMailOutcome,
  type InboundMailTextView,
  type InboundMailDecision,
  type InboundMailView,
  type IncompleteReason,
} from '@/lib/inbound-mail/inbound-mail-wire'
import { INBOUND_MAIL_RESTORE_DAYS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { capturePosthog } from '@/lib/analytics/posthog'
import { cn } from '@/lib/utils'
import { useShortcutsPreference } from '@/hooks/use-shortcuts-preference'
import { useInboxKeys, type InboxKeyTarget } from '../lib/inbox-keys'
import { useLandingReport } from '../lib/inbox-landing-report'
import { useInboxLive } from '../lib/inbox-live'
import { matchesQuery, nextOpenAfter, wasDecided } from '../lib/inbox-triage'
import { inboundMailAddressClient, inboundMailClient, type InboundMailAddressClient, type InboundMailClient } from '../lib/client'
import { asSuggested, fileableReason, type BulkDestination, type BulkPlan } from '../lib/completeness'
import type { DraftCopy, FolderOption } from '../lib/draft'
import { hasLoudMail, listSections, visibleMails, waitingShownCount } from '../lib/list-sections'
import { inboundMailPaths, type InboundMailPaths } from '@/lib/inbound-mail/paths'
import { refusalOf } from '../lib/refusal'
import { primeInboundMailWaiting, refreshInboundMailWaiting, useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { useInboundMailAddress } from '../hooks/use-inbound-mail-address'
import { useOpenFirstMail } from '../hooks/use-open-first-mail'
import { InboundMailAddressBlock, InboundMailAddressDialog } from './inbound-mail-address'
import { InboundMailHeaderActions } from './inbound-mail-header-actions'
import { InboundMailDetail, type DetailActions } from './inbound-mail-detail'
import { InboundMailList, type ListState } from './inbound-mail-list'
import { MailStepper } from './mail-stepper'
import { SelectionBar, type BulkBlock } from './selection-bar'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface InboundMailWorkspaceProps {
  projectId: string
  projectName: string
  projectClosed: boolean
  folders: readonly FolderOption[]
  status: InboundMailListStatus
  outcome: InboundMailOutcome | null
  initialList: InboundMailListView | null
  mailId: string | null
  initialMail: InboundMailView | null
  initialText?: InboundMailTextView | null
  client?: InboundMailClient
  addressClient?: InboundMailAddressClient
  paths?: InboundMailPaths
  initialListFailed?: boolean
  now?: number
  decidedByOther?: boolean
  listLoading?: boolean
  initialChecked?: readonly string[]
  pollMs?: number
}

type AsSuggestedSurface = 'row' | 'ready_section' | 'thread_group' | 'selection'

export function InboundMailWorkspace({
  projectId,
  projectName,
  projectClosed,
  folders,
  status,
  outcome,
  initialList,
  mailId,
  initialMail,
  initialText,
  client = inboundMailClient,
  addressClient = inboundMailAddressClient,
  paths: pathsProp,
  initialListFailed = false,
  now,
  decidedByOther,
  listLoading = false,
  initialChecked,
  pollMs,
}: InboundMailWorkspaceProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const phone = useMediaQuery(PHONE_QUERY)
  const backInHeader = useSectionBackSlot()
  const router = useRouter()
  const paths = useMemo(() => pathsProp ?? inboundMailPaths(projectId), [pathsProp, projectId])
  const filter = useMemo(() => ({ status, outcome }), [status, outcome])
  const [list, setList] = useState<ListState>(
    listLoading ? { kind: 'loading' } : initialList ? { kind: 'ready', ...initialList } : initialListFailed ? { kind: 'error' } : { kind: 'loading' }
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialChecked))
  const [focusedId, setFocusedId] = useState<string | null>(mailId)
  const [quietToggled, setQuietToggled] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [confirmErase, setConfirmErase] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => now ?? Date.now())
  const lastReload = useRef(initialList ? Date.now() : 0)
  const { enabled: shortcutsOn } = useShortcutsPreference()
  const [closedNoticeHidden, setClosedNoticeHidden] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const address = useInboundMailAddress(projectId, true, addressClient)
  const addressView = address.state.kind === 'ready' ? address.state.address : null
  const everReceived = addressView ? addressView.lastReceivedAt !== null : address.state.kind === 'error' ? true : null
  const detailActions = useRef<DetailActions | null>(null)
  const waiting = useInboundMailWaiting(projectId, true, client)

  const copy: DraftCopy = useMemo(
    () => ({ unnamedAttachment: (position) => t('attachments.unnamed', { position }), untitledThread: t('row.noSubject') }),
    [t]
  )

  useEffect(() => {
    if (initialList && status === 'waiting' && initialList.nextCursor === null) {
      primeInboundMailWaiting(projectId, { count: waitingShownCount(initialList.items), more: false })
    }
  }, [initialList, projectId, status])

  const reload = useCallback(async (): Promise<InboundMailListView | null> => {
    lastReload.current = Date.now()
    try {
      const page = await client.list(projectId, { status, outcome: outcome ?? undefined, limit: INBOUND_MAIL_LIST_LIMIT })
      setList({ kind: 'ready', ...page })
      if (now === undefined) setNowMs(Date.now())
      return page
    } catch {
      setList((current) => (current.kind === 'ready' ? current : { kind: 'error' }))
      return null
    }
  }, [client, projectId, status, outcome, now])

  const firstFilter = useRef(`${status}:${outcome ?? ''}`)
  useEffect(() => {
    if (listLoading) return
    const key = `${status}:${outcome ?? ''}`
    if (key === firstFilter.current && (initialList || initialListFailed)) return
    firstFilter.current = ''
    setList({ kind: 'loading' })
    void reload()
  }, [status, outcome, reload, initialList, initialListFailed, listLoading])

  const items = useMemo(() => (list.kind === 'ready' ? list.items : []), [list])
  const groups = useMemo(() => (list.kind === 'ready' ? list.threadGroups : []), [list])
  const sectionsOf = useCallback(
    (mails: readonly InboundMailSummaryView[], threadGroups: InboundMailListView['threadGroups']) =>
      listSections(query ? mails.filter((mail) => matchesQuery(mail, query)) : mails, { grouped: status === 'waiting', groups: threadGroups, now: nowMs }),
    [query, status, nowMs]
  )
  const sections = useMemo(() => sectionsOf(items, groups), [sectionsOf, items, groups])
  const quietOpen = quietToggled ?? !hasLoudMail(sections)
  const rows = useMemo(() => visibleMails(sections, quietOpen), [sections, quietOpen])
  const firstMail = useOpenFirstMail({ mailId, firstId: rows[0]?.id ?? null, scope: `${status}:${outcome ?? ''}`, open: (id) => router.replace(paths.mail(id, filter)) })

  const empty = list.kind === 'ready' && list.items.length === 0
  const never = empty && status === 'waiting' && everReceived === false

  const selectedIds = useMemo(() => items.filter((mail) => checked.has(mail.id)).map((mail) => mail.id), [items, checked])
  const [views, setViews] = useState<Map<string, InboundMailView>>(new Map())
  const [bulkFiling, setBulkFiling] = useState<string | null>(null)
  const [bulkDismissing, setBulkDismissing] = useState(false)
  const [confirmFile, setConfirmFile] = useState<{ decisions: InboundMailDecision[]; plan: BulkPlan; surface: AsSuggestedSurface } | null>(null)
  const [rowFiling, setRowFiling] = useState<string | null>(null)
  const [confirmDismiss, setConfirmDismiss] = useState(false)

  const readViews = useCallback(
    async (ids: string[]): Promise<Map<string, InboundMailView>> => {
      const updatedAt = new Map(items.map((mail) => [mail.id, mail.updatedAt]))
      const stale = ids.filter((id) => views.get(id)?.updatedAt !== updatedAt.get(id))
      if (stale.length === 0) return views
      const read = await Promise.all(stale.map((id) => client.get(projectId, id).catch(() => null)))
      const next = new Map(views)
      for (const view of read) if (view) next.set(view.id, view)
      setViews(next)
      return next
    },
    [items, views, client, projectId]
  )

  const blockFor = useCallback((ids: string[], reasonOf: (id: string) => IncompleteReason | null): BulkBlock => {
    if (ids.length > INBOUND_MAIL_DECISION_MAX_MAILS) return { reason: 'too_many', count: ids.length }
    const reasons = new Map<IncompleteReason, number>()
    for (const id of ids) {
      const reason = reasonOf(id)
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    const first = [...reasons.entries()][0]
    return first ? { reason: first[0], count: first[1] } : null
  }, [])

  const summaryReason = useCallback(
    (id: string): IncompleteReason | null => {
      const mail = items.find((candidate) => candidate.id === id)
      return mail ? fileableReason(mail) : 'not_waiting'
    },
    [items]
  )
  const selectionBlock = blockFor(selectedIds, summaryReason)

  const destinationLine = (destination: BulkDestination): string =>
    destination.kind === 'folder' && destination.label === ''
      ? t('bulk.destination.root', { count: destination.count })
      : t(`bulk.destination.${destination.kind}`, { label: destination.label, count: destination.count })

  const prepare = async (ids: string[], groupId: string | null): Promise<Extract<ReturnType<typeof asSuggested>, { ok: true }> | null> => {
    const refuse = (block: BulkBlock): boolean => {
      if (!block) return false
      if (groupId) router.push(paths.mail(ids[0], filter))
      else toast.error(t(`bulk.blocked.${block.reason}`, { count: block.count, max: INBOUND_MAIL_DECISION_MAX_MAILS }))
      return true
    }
    if (refuse(blockFor(ids, summaryReason))) return null
    const read = await readViews(ids)
    const current = ids.map((id) => read.get(id)).filter((view): view is InboundMailView => !!view)
    if (current.length < ids.length) {
      refuse({ reason: 'not_waiting', count: ids.length - current.length })
      void changed()
      return null
    }
    const built = asSuggested(current, folders, copy)
    if (!built.ok) {
      refuse({ reason: built.reason, count: built.count })
      void changed()
      return null
    }
    return built
  }

  const askFile = async (ids: string[], groupId: string | null, surface: AsSuggestedSurface): Promise<void> => {
    if (groupId) setBulkFiling(groupId)
    const built = await prepare(ids, groupId).finally(() => groupId && setBulkFiling(null))
    if (built) setConfirmFile({ decisions: built.decisions, plan: built.plan, surface })
  }

  const send = async (decisions: InboundMailDecision[], plan: BulkPlan, surface: AsSuggestedSurface): Promise<void> => {
    const result = await client.file(projectId, { mails: decisions })
    const description = plan.destinations.map(destinationLine).join(CLAUSE_JOIN)
    capturePosthog('inbound_mail_filed_as_suggested', { surface, mails: decisions.length, files: plan.files, texts: plan.texts })
    const sent = decisions.length === 1 ? result.mails.find((mail) => mail.id === decisions[0].mailId) : undefined
    if (sent) {
      const toastId = toast.loading(t('toast.filedAsSuggested', { count: 1 }), { description })
      void changed()
      void reportLanding(sent, decisions[0], toastId)
      return
    }
    toast.success(t('toast.filedAsSuggested', { count: decisions.length }), { description })
    void changed()
  }

  const fileOne = async (mailId: string): Promise<void> => {
    if (rowFiling) return
    setRowFiling(mailId)
    try {
      const built = await prepare([mailId], null)
      if (built) await send(built.decisions, built.plan, 'row')
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      void changed()
    } finally {
      setRowFiling(null)
    }
  }

  const fileConfirmed = async (): Promise<void> => {
    if (!confirmFile) return
    setBulkFiling('selection')
    try {
      await send(confirmFile.decisions, confirmFile.plan, confirmFile.surface)
      setChecked(new Set())
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      void changed()
      throw error
    } finally {
      setBulkFiling(null)
    }
  }

  const eraseConfirmed = async (): Promise<void> => {
    if (!confirmErase) return
    try {
      await client.dismiss(projectId, { mailIds: [confirmErase] })
      toast.success(t('toast.dismissed'))
      await changed()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      throw error
    }
  }

  const dismissConfirmed = async (): Promise<void> => {
    setBulkDismissing(true)
    try {
      await client.dismiss(projectId, { mailIds: selectedIds })
      toast.success(t('toast.dismissedMany', { count: selectedIds.length }))
      setChecked(new Set())
      void changed()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      throw error
    } finally {
      setBulkDismissing(false)
    }
  }

  const toggle = (id: string, value: boolean): void =>
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })

  const keyState = useRef({ rows, mailId })
  keyState.current = { rows, mailId }

  const changed = useCallback(async (): Promise<void> => {
    const before = keyState.current
    const refreshed = refreshInboundMailWaiting(projectId, client)
    const page = await reload()
    void refreshed
    const open = before.mailId
    if (!page || status !== 'waiting' || !open || keyState.current.mailId !== open) return
    const nextSections = sectionsOf(page.items, page.threadGroups)
    const after = visibleMails(nextSections, quietToggled ?? !hasLoudMail(nextSections))
    if (!wasDecided(open, before.rows, page.items)) return
    const next = nextOpenAfter(open, before.rows, after)
    if (next) {
      setFocusedId(next)
      if (!phone) setFocusTarget(next)
      router.replace(paths.mail(next, filter))
    } else {
      router.replace(paths.list(filter))
    }
  }, [projectId, client, reload, status, sectionsOf, quietToggled, phone, router, paths, filter])

  useInboxLive({ projectId, enabled: status === 'waiting', stamp: waiting.stamp, lastRead: lastReload, reload })

  const reportLanding = useLandingReport({ client, projectId, pollMs, onSettled: () => void changed() })

  const keyTarget = useRef<InboxKeyTarget | null>(null)
  keyTarget.current = {
    rows,
    items,
    focusedId,
    mailId,
    selectedIds,
    checked,
    focus: setFocusedId,
    open: (id) => router.push(paths.mail(id, filter)),
    toggle,
    preview: () => detailActions.current?.preview(),
    file: () => detailActions.current?.file(),
    dismissOpen: () => detailActions.current?.dismiss(),
    askDismissSelection: () => setConfirmDismiss(true),
    askErase: setConfirmErase,
  }
  useInboxKeys(shortcutsOn, firstMail.ref, keyTarget)

  useEffect(() => {
    if (!focusTarget || mailId !== focusTarget) return
    const link = firstMail.ref.current?.querySelector<HTMLElement>(`[data-mail-id="${CSS.escape(focusTarget)}"] [data-testid="inbound-mail-row-link"]`)
    if (!link) return
    link.focus({ preventScroll: true })
    link.scrollIntoView({ block: 'nearest' })
    setFocusTarget(null)
  }, [focusTarget, mailId, list, firstMail.ref])


  const notice =
    projectClosed && !closedNoticeHidden ? (
      <Alert className="rounded-none border-x-0 border-t-0" data-testid="inbound-mail-closed">
        <Lock aria-hidden className="text-warning" />
        <AlertTitle className="line-clamp-none">{t('closed.title')}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>{t('closed.text')}</span>
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('closed.dismiss')} onClick={() => setClosedNoticeHidden(true)}>
            <X className="size-4" aria-hidden />
          </Button>
        </AlertDescription>
      </Alert>
    ) : null

  const selectionBar =
    selectedIds.length > 0 ? (
      <SelectionBar
        count={selectedIds.length}
        block={selectedIds.length > INBOUND_MAIL_DECISION_MAX_MAILS ? { reason: 'too_many', count: selectedIds.length } : selectionBlock}
        max={INBOUND_MAIL_DECISION_MAX_MAILS}
        filing={bulkFiling === 'selection'}
        dismissing={bulkDismissing}
        onFile={() => void askFile(selectedIds, null, 'selection')}
        onDismiss={() => setConfirmDismiss(true)}
        onClear={() => setChecked(new Set())}
      />
    ) : null

  const back = (
    <Button asChild variant="ghost" size="sm" className={cn('-ml-3.5 w-fit @3xl:hidden', backInHeader && 'phone:hidden')} /* its 14px padding given back */>
      <Link href={paths.list(filter)} data-testid="inbound-mail-back">
        <ArrowLeft className="size-4" aria-hidden />
        {t('title')}
        <ProjectSectionBack href={paths.list(filter)} to={t('title')} />
      </Link>
    </Button>
  )

  return (
    <div ref={firstMail.ref} className="@container listing-container flex h-full min-h-0 flex-col" data-testid="inbound-mail-workspace">
      <ProjectSectionActions onTitleLine>
        {/* An opened mail on a phone has the step to the next mail where the address's menu stands on the list. */}
        {mailId && phone ? (
          <MailStepper ids={rows.map((mail) => mail.id)} openId={mailId} hrefFor={(id) => paths.mail(id, filter)} />
        ) : (
          !never && <InboundMailHeaderActions state={address.state} onOpenAddress={() => setAddressOpen(true)} compact={phone} />
        )}
      </ProjectSectionActions>
      {/* Nothing to pick, nothing to show beside it: an empty list takes the whole width, without the „Wählen Sie …“ pane. */}
      {/* At the split two whole objects on the title's edges (32px in): the list on the desk, the reader a sheet, 16px
          apart and 24px off the foot, so both show their corners. The rows sit 8px inside the desk's edge. */}
      {/* 24px under the header's rule (16px on a phone): the list's desk and the open mail started on the rule and
          read as hung from it (review of 2026-11-11). */}
      <div className={cn('flex min-h-0 flex-1 flex-col pt-4 @3xl:pt-6', !(empty && !mailId) && '@3xl:grid @3xl:grid-cols-[26rem_minmax(0,1fr)] @3xl:gap-4 @3xl:px-8 @3xl:pb-6')}>
        <div className={cn('min-h-0 flex-1 flex-col md:px-4', !(empty && !mailId) && '@3xl:flex @3xl:rounded-surface @3xl:bg-desk @3xl:px-2', mailId ? 'hidden' : 'flex')}>
          <InboundMailList
            state={list}
            sections={sections}
            status={status}
            onFilterChange={(nextStatus, nextOutcome) => {
              setChecked(new Set())
              setQuery('')
              router.replace(paths.list({ status: nextStatus, outcome: nextOutcome }))
            }}
            waitingCount={waiting.count}
            waitingMore={waiting.more}
            query={query}
            onQueryChange={setQuery}
            matchCount={rows.length}
            now={nowMs}
            openId={mailId}
            focusedId={focusedId}
            checked={checked}
            onCheckedChange={toggle}
            onFocusRow={setFocusedId}
            hrefFor={(id) => paths.mail(id, filter)}
            quietOpen={quietOpen}
            onQuietOpenChange={setQuietToggled}
            onFileGroup={(threadId, ids) => void askFile(ids, threadId, 'thread_group')}
            fileGroupBusy={bulkFiling}
            onFileOne={(id) => void fileOne(id)}
            fileOneBusy={rowFiling}
            onFileReady={(ids) => void askFile(ids, null, 'ready_section')}
            onRetry={() => reload()}
            onLoadMore={async () => {
              if (list.kind !== 'ready' || !list.nextCursor) return
              setLoadingMore(true)
              try {
                const page = await client.list(projectId, { status, outcome: outcome ?? undefined, cursor: list.nextCursor })
                const known = new Set(list.threadGroups.map((group) => group.threadId))
                setList({
                  kind: 'ready',
                  items: [...list.items, ...page.items],
                  threadGroups: [...list.threadGroups, ...page.threadGroups.filter((group) => !known.has(group.threadId))],
                  nextCursor: page.nextCursor,
                })
              } catch {
                toast.error(t('loadError'))
              } finally {
                setLoadingMore(false)
              }
            }}
            loadingMore={loadingMore}
            everReceived={everReceived}
            addressBlock={
              addressView?.address ? (
                <InboundMailAddressBlock
                  address={addressView}
                  projectId={projectId}
                  projectName={projectName}
                  surface="never_used"
                />
              ) : addressView?.canManage ? (
                <Button type="button" size="sm" className="w-fit" onClick={() => setAddressOpen(true)} data-testid="inbound-mail-never-create">
                  <MailPlus className="size-4" aria-hidden />
                  {t('address.create')}
                </Button>
              ) : null
            }
            showFilter={!never}
            neverCase={!addressView || addressView.address ? 'address' : addressView.canManage ? 'create' : 'ask'}
            selectionBar={selectionBar}
            notice={notice}
          />
        </div>
        <div
          className={cn('min-h-0 flex-1', !(empty && !mailId) && '@3xl:block @3xl:overflow-y-auto @3xl:rounded-surface @3xl:bg-sheet @3xl:shadow-sm', mailId ? 'block overflow-y-auto overscroll-contain' : 'hidden')}
          data-testid="inbound-mail-detail-pane"
        >
          {mailId ? (
            <InboundMailDetail
              key={mailId}
              projectId={projectId}
              mailId={mailId}
              initial={initialMail}
              initialText={initialText}
              folders={folders}
              client={client}
              onChanged={() => void changed()}
              back={back}
              actionsRef={detailActions}
              now={now}
              decidedByOther={decidedByOther}
              yieldPrimary={selectedIds.length > 0}
            />
          ) : list.kind === 'loading' || firstMail.pending ? null /* nothing to pick yet, or the first mail on its way */ : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="inbound-mail-no-selection">
              <MailSearch className="size-5" aria-hidden />
              <p className="max-w-xs text-sm text-balance">{checked.size > 0 ? t('bulk.paneHint') : t('noSelection')}</p>
            </div>
          )}
        </div>
      </div>

      <InboundMailAddressDialog
        projectId={projectId}
        projectName={projectName}
        open={addressOpen}
        onOpenChange={(open) => {
          setAddressOpen(open)
          if (!open) void address.reload()
        }}
        client={addressClient}
      />
      <ConfirmDialog
        open={confirmFile !== null}
        onOpenChange={(open) => !open && setConfirmFile(null)}
        title={confirmFile ? t('bulk.confirmTitle', { count: confirmFile.plan.mails }) : ''}
        description={
          confirmFile ? (
            <div className="flex flex-col gap-2">
              <p>{t('bulk.confirmSummary', { files: confirmFile.plan.files, texts: confirmFile.plan.texts })}</p>
              <ul className="flex flex-col gap-1" data-testid="bulk-destinations">
                {confirmFile.plan.destinations.map((destination) => (
                  <li key={`${destination.kind}:${destination.label}`} className="[overflow-wrap:anywhere]">
                    {destinationLine(destination)}
                  </li>
                ))}
              </ul>
            </div>
          ) : undefined
        }
        confirmLabel={t('bulk.confirm')}
        cancelLabel={t('bulk.cancel')}
        onConfirm={fileConfirmed}
        confirmTestId="bulk-file-confirm"
      />
      <ConfirmDialog
        open={confirmErase !== null}
        onOpenChange={(open) => !open && setConfirmErase(null)}
        title={t('dismissFinal.title')}
        description={t('dismissFinal.text')}
        confirmLabel={t('dismissFinal.confirm')}
        cancelLabel={t('bulk.cancel')}
        tone="warning"
        onConfirm={eraseConfirmed}
        confirmTestId="dismiss-final-confirm"
      />
      <ConfirmDialog
        open={confirmDismiss}
        onOpenChange={setConfirmDismiss}
        title={t('bulk.dismissTitle', { count: selectedIds.length })}
        description={t('bulk.dismissText', { days: INBOUND_MAIL_RESTORE_DAYS })}
        confirmLabel={t('bulk.dismissConfirm')}
        cancelLabel={t('bulk.cancel')}
        tone="warning"
        onConfirm={dismissConfirmed}
        confirmTestId="bulk-dismiss-confirm"
      />
    </div>
  )
}
