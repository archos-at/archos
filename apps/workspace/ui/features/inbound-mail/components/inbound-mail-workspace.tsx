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
import { bulkSelectable } from '../lib/impersonation'
import { useMailSelection } from '../lib/use-mail-selection'
import { useHeldFilings } from '../lib/use-held-filings'
import { useInboxKeys, type InboxKeyTarget } from '../lib/inbox-keys'
import { useBulkLandingReport, useLandingReport } from '../lib/inbox-landing-report'
import { useStartHint } from '../lib/inbox-start'
import { useInboxLive } from '../lib/inbox-live'
import { matchesQuery, nextOpenAfter, wasDecided } from '../lib/inbox-triage'
import { inboundMailAddressClient, inboundMailClient, type InboundMailAddressClient, type InboundMailClient } from '../lib/client'
import { asSuggested, fileableReason, type BulkDestination, type BulkPlan } from '../lib/completeness'
import type { FolderOption } from '../lib/draft'
import { hasLoudMail, listSections, visibleMails, waitingShownCount } from '../lib/list-sections'
import { inboundMailPaths, type InboundMailPaths } from '@/lib/inbound-mail/paths'
import { refusalOf } from '../lib/refusal'
import { primeInboundMailWaiting, refreshInboundMailWaiting, useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { useInboundMailAddress } from '../hooks/use-inbound-mail-address'
import { useOpenFirstMail } from '../hooks/use-open-first-mail'
import { useDraftCopy } from '../hooks/use-draft-copy'
import { InboundMailAddressBlock, InboundMailAddressDialog, InboundMailStartHint } from './inbound-mail-address'
import { InboundMailHeaderActions } from './inbound-mail-header-actions'
import { InboundMailDetail, type DetailActions } from './inbound-mail-detail'
import { InboundMailList, type ListState } from './inbound-mail-list'
import { mailToast } from './inbound-mail-atoms'
import { MailStepper } from './mail-stepper'
import { SelectionPreview } from './selection-preview'
import { SelectionBar, type BulkBlock } from './selection-bar'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { FileSearchField, TOOL_ROW_SEARCH_CLASS } from '@/features/documents'

export interface InboundMailWorkspaceProps {
  projectId: string
  projectName: string
  projectClosed: boolean
  folders: readonly FolderOption[]
  status: InboundMailListStatus
  outcome: InboundMailOutcome | null
  initialQuery?: string
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
  holdMs?: number
}

const NEAR_THE_PRESS = { position: 'bottom-left' as const }

type AsSuggestedSurface = 'ready_section' | 'selection'

export function InboundMailWorkspace({
  projectId,
  projectName,
  projectClosed,
  folders,
  status,
  outcome,
  initialQuery = '',
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
  holdMs,
}: InboundMailWorkspaceProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const phone = useMediaQuery(PHONE_QUERY)
  const backInHeader = useSectionBackSlot()
  const router = useRouter()
  const paths = useMemo(() => pathsProp ?? inboundMailPaths(projectId), [pathsProp, projectId])
  const [query, setQueryState] = useState(initialQuery)
  const filter = useMemo(() => ({ status, outcome, query }), [status, outcome, query])
  const [list, setList] = useState<ListState>(
    listLoading ? { kind: 'loading' } : initialList ? { kind: 'ready', ...initialList } : initialListFailed ? { kind: 'error' } : { kind: 'loading' }
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const { checked, selecting, start: startSelection, end: endSelection, toggle } = useMailSelection(initialChecked)
  const [focusedId, setFocusedId] = useState<string | null>(mailId)
  const [quietToggled, setQuietToggled] = useState<boolean | null>(null)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => now ?? Date.now())
  const lastReload = useRef(initialList ? Date.now() : 0)
  const { enabled: shortcutsOn } = useShortcutsPreference()
  const [closedNoticeHidden, setClosedNoticeHidden] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const address = useInboundMailAddress(projectId, true, addressClient)
  const addressView = address.state.kind === 'ready' ? address.state.address : null
  const everReceived = addressView ? addressView.lastReceivedAt !== null : address.state.kind === 'error' ? true : null
  const startHint = useStartHint(projectId, addressView)
  const detailActions = useRef<DetailActions | null>(null)
  const waiting = useInboundMailWaiting(projectId, true, client)

  const copy = useDraftCopy()

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      const at = { status, outcome, query: next }
      window.history.replaceState(null, '', mailId ? paths.mail(mailId, at) : paths.list(at))
    },
    [status, outcome, mailId, paths]
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

  const { held, hold } = useHeldFilings(holdMs)
  const items = useMemo(() => (list.kind === 'ready' ? list.items.filter((mail) => !held.has(mail.id)) : []), [list, held])
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
  const readyIds = selectedIds.filter((id) => summaryReason(id) === null)
  const selectionBlock = readyIds.length > 0 ? null : blockFor(selectedIds, summaryReason)

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
    const ids = decisions.map((decision) => decision.mailId)
    const description = plan.destinations.map(destinationLine).join(CLAUSE_JOIN)
    hold({ ids, label: t('toast.held', { count: ids.length }), undoLabel: t('toast.undo'), toastOptions: mailToast({ ...NEAR_THE_PRESS, description }), onUndo: () => undefined, run: async (held) => {
      try {
        const result = await client.file(projectId, { mails: decisions })
        capturePosthog('inbound_mail_filed_as_suggested', { surface, mails: decisions.length, files: plan.files, texts: plan.texts })
        const toastId = toast.loading(t('toast.filedAsSuggested', { count: decisions.length }), { id: held, description, action: undefined })
        void changed()
        const sent = decisions.length === 1 ? result.mails.find((mail) => mail.id === decisions[0].mailId) : undefined
        if (sent) void reportLanding(sent, decisions[0], toastId)
        else void reportBulk(result.mails, decisions, toastId)
      } catch (error) {
        toast.error(t(`refusals.${refusalOf(error)}`), { id: held, action: undefined })
        void changed()
      }
    } })
  }

  const fileConfirmed = async (): Promise<void> => {
    if (!confirmFile) return
    setBulkFiling('selection')
    try {
      await send(confirmFile.decisions, confirmFile.plan, confirmFile.surface)
      endSelection()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      void changed()
      throw error
    } finally {
      setBulkFiling(null)
    }
  }

  const dismissConfirmed = async (): Promise<void> => {
    setBulkDismissing(true)
    try {
      await client.dismiss(projectId, { mailIds: selectedIds })
      const ids = [...selectedIds]
      toast.success(t('toast.dismissedMany', { count: ids.length }), { action: { label: t('toast.undo'), onClick: () => void Promise.all(ids.map((id) => client.restore(projectId, id))).finally(() => void changed()) } })
      endSelection()
      void changed()
    } catch (error) {
      toast.error(t(`refusals.${refusalOf(error)}`))
      throw error
    } finally {
      setBulkDismissing(false)
    }
  }

  const keyState = useRef({ rows, mailId })
  keyState.current = { rows, mailId }

  const advance = useCallback(
    (decided: string, before: readonly InboundMailSummaryView[], after: readonly InboundMailSummaryView[]): void => {
      const next = nextOpenAfter(decided, before, after)
      if (next) {
        setFocusedId(next)
        if (!phone) setFocusTarget(next)
        router.replace(paths.mail(next, filter))
      } else {
        router.replace(paths.list(filter))
      }
    },
    [phone, router, paths, filter]
  )

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
    advance(open, before.rows, after)
  }, [projectId, client, reload, status, sectionsOf, quietToggled, advance])

  useInboxLive({ projectId, enabled: status === 'waiting', stamp: waiting.stamp, lastRead: lastReload, reload })

  const reportLanding = useLandingReport({ client, projectId, pollMs, onSettled: () => void changed() })

  const holdOpen = (view: InboundMailView, decision: InboundMailDecision): void => {
    const { rows: before, mailId: open } = keyState.current
    hold({ ids: [view.id], label: t('toast.held', { count: 1 }), undoLabel: t('toast.undo'), toastOptions: mailToast(NEAR_THE_PRESS), onUndo: () => router.push(paths.mail(view.id, filter)), run: async (toastId) => {
      try {
        const sent = (await client.file(projectId, { mails: [decision] })).mails.find((mail) => mail.id === view.id)
        if (sent) filedOpen(sent, decision, toastId)
      } catch (error) {
        toast.error(t(`refusals.${refusalOf(error)}`), { id: toastId, action: undefined })
        void changed()
      }
    } })
    if (status === 'waiting' && open === view.id) advance(open, before, before.filter((mail) => mail.id !== open))
  }

  const filedOpen = (sent: InboundMailView, decision: InboundMailDecision, held?: string | number): void => {
    const toastId = toast.loading(t('toast.filing'), mailToast({ id: held, action: undefined }))
    const { rows: before, mailId: open } = keyState.current
    if (status === 'waiting' && open === sent.id) advance(open, before, before.filter((mail) => mail.id !== open))
    void reload()
    void reportLanding(sent, decision, toastId)
  }
  const showHandled = useCallback(() => router.replace(paths.list({ status: 'handled', outcome: null })), [router, paths])
  const reportBulk = useBulkLandingReport({ client, projectId, pollMs, onSettled: () => void changed(), onShowHandled: showHandled })


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
    selecting ? (
      <SelectionBar
        count={selectedIds.length}
        fileCount={readyIds.length}
        block={readyIds.length > INBOUND_MAIL_DECISION_MAX_MAILS ? { reason: 'too_many', count: readyIds.length } : selectionBlock}
        max={INBOUND_MAIL_DECISION_MAX_MAILS}
        filing={bulkFiling === 'selection'}
        dismissing={bulkDismissing}
        onFile={() => void askFile(readyIds, null, 'selection')}
        onDismiss={() => setConfirmDismiss(true)}
        onClear={endSelection}
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
      <ProjectSectionActions onTitleLine={phone}>
        {/* An opened mail on a phone has the step to the next mail where the address's menu stands on the list. */}
        {mailId && phone ? (
          <MailStepper ids={rows.map((mail) => mail.id)} openId={mailId} hrefFor={(id) => paths.mail(id, filter)} />
        ) : phone ? (
          !never && <InboundMailHeaderActions state={address.state} onOpenAddress={() => setAddressOpen(true)} compact />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3" data-testid="inbound-mail-tools">
            {!never && (
              <FileSearchField
                className={TOOL_ROW_SEARCH_CLASS}
                size="sm"
                value={query}
                onChange={setQuery}
                onSubmit={() => {}}
                onClear={() => setQuery('')}
                placeholder={t('search.placeholder')}
                searchLabel={t('search.label')}
                resetLabel={t('search.clear')}
              />
            )}
            <div className="ml-auto flex shrink-0 items-center">
              {!never && <InboundMailHeaderActions state={address.state} onOpenAddress={() => setAddressOpen(true)} />}
            </div>
          </div>
        )}
      </ProjectSectionActions>
      {/* Nothing to pick, nothing to show beside it: an empty list takes the whole width, without the „Wählen Sie …“ pane. */}
      {/* At the split the list stands on the page itself and the reader is the one sheet, 16px apart and 24px off the
          foot; a grey panel behind the list made two boxes compete with the mail (owner review, 2026-11-25). The list's
          text stands on the title's edge, its row fills bleeding out to the left. */}
      {/* 24px under the header's rule (16px on a phone): the list and the open mail started on the rule and
          read as hung from it (review of 2026-11-11). */}
      <div className={cn('flex min-h-0 flex-1 flex-col pt-4 @3xl:pt-6', !(empty && !mailId) && '@3xl:grid @3xl:grid-cols-[26rem_minmax(0,1fr)] @3xl:gap-4 @3xl:px-8 @3xl:pb-6')}>
        <div className={cn('min-h-0 flex-1 flex-col md:px-4', !(empty && !mailId) && '@3xl:-ml-4 @3xl:flex @3xl:px-0', mailId ? 'hidden' : 'flex')}>
          <InboundMailList
            state={list}
            sections={sections}
            status={status}
            onFilterChange={(nextStatus, nextOutcome) => {
              endSelection()
              setQueryState('')
              router.replace(paths.list({ status: nextStatus, outcome: nextOutcome }))
            }}
            query={query}
            onQueryChange={setQuery}
            searchInList={phone}
            matchCount={rows.length}
            now={nowMs}
            openId={mailId}
            focusedId={focusedId}
            checked={checked}
            selecting={selecting}
            onStartSelection={status === 'waiting' && items.some((mail) => bulkSelectable(mail)) ? startSelection : undefined}
            onCheckedChange={(id, value) => {
              toggle(id, value)
              setFocusedId(null)
            }}
            onFocusRow={setFocusedId}
            hrefFor={(id) => paths.mail(id, filter)}
            quietOpen={quietOpen}
            onQuietOpenChange={setQuietToggled}
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
            startHint={
              status === 'waiting' && !never && startHint.shown && addressView?.address ? (
                <InboundMailStartHint address={addressView.address} onDismiss={startHint.dismiss} />
              ) : null
            }
          />
        </div>
        <div
          className={cn('min-h-0 flex-1', !(empty && !mailId) && '@3xl:block @3xl:overflow-y-auto @3xl:rounded-surface @3xl:bg-sheet @3xl:shadow-sm', mailId ? 'block overflow-y-auto overscroll-contain' : 'hidden')}
          data-testid="inbound-mail-detail-pane"
        >
          {selecting && <SelectionPreview mails={items.filter((mail) => checked.has(mail.id))} />}
          {mailId ? (
            <div className={selecting ? 'hidden' : 'contents'}>
            <InboundMailDetail
              key={mailId}
              projectId={projectId}
              mailId={mailId}
              initial={initialMail}
              initialText={initialText}
              folders={folders}
              client={client}
              onChanged={() => void changed()}
              onFiled={filedOpen}
              onHold={holdOpen}
              back={back}
              actionsRef={detailActions}
              now={now}
              decidedByOther={decidedByOther}
              yieldPrimary={selectedIds.length > 0}
            />
            </div>
          ) : selecting || list.kind === 'loading' || firstMail.pending ? null : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="inbound-mail-no-selection">
              <MailSearch className="size-5" aria-hidden />
              <p className="max-w-xs text-sm text-balance">{t('noSelection')}</p>
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
