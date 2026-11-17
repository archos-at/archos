'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { toast } from 'sonner'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SectionLabel } from '@/components/ui/section-label'
import { InspectorGroup } from '@/components/ui/inspector-group'
import { Skeleton } from '@/components/ui/skeleton'
import { StageTrack } from '@/components/ui/stage-track'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatDate } from '@/lib/format'
import { distinguishingTailLength } from '@/lib/text/middle-truncate'
import { cn } from '@/lib/utils'
import type { RevisionLinks, RevisionHistoryEntry } from '@/lib/documents/revision-links'
import type { DocumentLifecycleClient } from '@/lib/documents/lifecycle-client'
import { documentLifecycleClient, versionFileUrl } from '@/lib/documents/lifecycle-client'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import { readDocumentText } from '@/lib/documents/text-client'
import { documentReadFamily } from '@/lib/documents/document-status'
import type { FileItem } from '../file-types'
import {
  newestVersion,
  useDocumentLifecycle,
  type DocumentLifecycleSummary,
} from '../hooks/use-document-lifecycle'
import {
  LIFECYCLE_STAGES,
  availableLifecycleGestures,
  canArchiveDocument,
  lifecycleNeedsReader,
  type DocumentLifecycleViewer,
} from '../lib/document-lifecycle'
import { revisionStanding, resolvePerson, type RevisionStanding, type NextStep } from '../lib/revision-standing'
import {
  buildRevisionTimeline,
  revisionTag,
  isPendingVersion,
  latestAct,
  numberOfVersion,
  showsRevisionsSection,
  versionActs,
  versionContentUrl,
  type RevisionTag,
  type HeadRow,
  type LinkedRow,
  type NewerRow,
  type TimelineRow,
  type VersionAct,
  type VersionRow,
} from '@/lib/documents/revision-timeline'
import { requestRevisionLink } from '../lib/revision-request'
import { DocumentArchiveAction } from './document-archive-action'
import { DocumentReviewControls, type DocumentReviewControlsProps } from './document-review-controls'
import { TextComparisonView, type TextComparison } from './revision-text-comparison'
import { DocumentVersionStateBadge } from './document-version-badge'
import { useRevisionCompare, type SourceLoader } from './revision-compare'
import type { CompareFile } from './revision-compare/types'
import { SuggestionNotice } from './revision-notices'
import { RevisionTimelineRow, RowAction } from './revision-timeline-row'
import { MailOriginLine, useOpenMailOrigin } from './mail-thread/mail-origin-line'
import { mailThreadClient } from './mail-thread/client'

export interface DocumentRevisionsProps {
  file: FileItem
  projectId?: string
  canManage: boolean
  viewer?: DocumentLifecycleViewer
  names?: Readonly<Record<string, string>>
  client?: DocumentLifecycleClient
  compareSource?: SourceLoader
  onRevisionChanged?: (fileId: string, revision: RevisionLinks) => void
  onOpenDocument?: (fileId: string) => void
  onLifecycleChanged?: (summary: DocumentLifecycleSummary) => void
  openMarks?: DocumentReviewControlsProps['openMarks']
  className?: string
}

const NOTABLE_ROW_STATES: ReadonlySet<DocumentVersionView['state']> = new Set([
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'rejected',
])

const STAGE_LABEL_KEYS = [
  'lifecycle.states.draft',
  'lifecycle.states.inReview',
  'lifecycle.states.approved',
  'lifecycle.states.published',
] as const

export function DocumentRevisions({
  file,
  projectId,
  canManage,
  viewer,
  names,
  client = documentLifecycleClient,
  compareSource,
  onRevisionChanged,
  onOpenDocument,
  onLifecycleChanged,
  openMarks,
  className,
}: DocumentRevisionsProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()

  const [facts, setFacts] = useState<RevisionLinks | null>(file.revision ?? null)
  const [busy, setBusy] = useState(false)
  const currentId = useRef(file.id)
  currentId.current = file.id
  useEffect(() => setFacts(file.revision ?? null), [file.id, file.revision])

  const lifecycleEnabled = viewer !== undefined || (file.versionCount ?? 1) > 1
  const { listing, loading, failed, pending, reviewers, act } = useDocumentLifecycle({
    documentId: file.id,
    enabled: lifecycleEnabled,
    withReviewers: viewer !== undefined,
    client,
    onChanged: onLifecycleChanged,
  })

  const [textComparison, setTextComparison] = useState<TextComparison | null>(null)
  const openMailOrigin = useOpenMailOrigin(projectId ?? '', mailThreadClient)
  const rowsRef = useRef<readonly TimelineRow[]>([])

  const compareDocumentsAsText = useCallback(
    async (older: CompareFile, newer: CompareFile) => {
      const fileId = file.id
      const other = older.id === fileId ? newer.id : older.id
      const row = rowsRef.current.find(
        (candidate) =>
          (candidate.kind === 'linked' && candidate.entry.id === other) ||
          (candidate.kind === 'newer' && candidate.ref.id === other),
      )
      if (!row) return
      const own = rowsRef.current.find((candidate) => candidate.kind === 'head' || (candidate.kind === 'version' && candidate.newest))
      const numberOf = (id: string) => (id === other ? row.number : (own?.number ?? 0))
      setTextComparison({ rowKey: row.key, status: 'loading' })
      try {
        const [from, to] = await Promise.all([readDocumentText(older.id), readDocumentText(newer.id)])
        if (currentId.current !== fileId) return
        setTextComparison({
          rowKey: row.key,
          status: 'done',
          from: { number: numberOf(older.id), content: from.text },
          to: { number: numberOf(newer.id), content: to.text },
        })
      } catch {
        if (currentId.current === fileId) setTextComparison({ rowKey: row.key, status: 'failed' })
      }
    },
    [file.id],
  )
  const openTextCompare = useCallback(
    (older: CompareFile, newer: CompareFile) => void compareDocumentsAsText(older, newer),
    [compareDocumentsAsText],
  )
  const { openRevisionCompare, compareElement } = useRevisionCompare(compareSource, { onOpenTextCompare: openTextCompare })

  const supersededBy = facts?.supersededBy ?? null
  const suggestion = facts?.suggestion ?? null
  const changeSummary = facts?.changeSummary ?? null
  const history: readonly RevisionHistoryEntry[] =
    facts?.history ?? (facts?.supersedes ?? []).map((ref) => ({ ...ref, createdAt: null, changeSummary: null }))
  const directIds = new Set((facts?.supersedes ?? []).map((ref) => ref.id))

  const versions = listing?.versions ?? []
  const newest = newestVersion(versions)
  const lifecycle = listing?.lifecycle ?? 'active'

  const attention =
    suggestion !== null ||
    supersededBy !== null ||
    (viewer !== undefined && listing !== null && lifecycleNeedsReader(newest, lifecycle, viewer))
  const [open, setOpen] = useState(attention)
  const openedForAttention = useRef(attention)
  useEffect(() => {
    if (!attention || openedForAttention.current) return
    openedForAttention.current = true
    setOpen(true)
  }, [attention])

  const decide = useCallback(
    async (olderId: string, linked: boolean) => {
      const fileId = file.id
      setBusy(true)
      try {
        const answer = await requestRevisionLink(fileId, olderId, linked)
        onRevisionChanged?.(fileId, answer.newer)
        onRevisionChanged?.(olderId, answer.older)
        if (currentId.current === fileId) setFacts(answer.newer)
      } catch {
        if (currentId.current === fileId) toast.error(t('preview.revision.saveError'))
      } finally {
        setBusy(false)
      }
    },
    [file.id, onRevisionChanged, t],
  )

  const compareText = useCallback(
    async (rowKey: string, from: DocumentVersionView, to: DocumentVersionView, numbers: { from: number; to: number }) => {
      const fileId = file.id
      setTextComparison({ rowKey, status: 'loading' })
      try {
        const data = await client.diff(fileId, from.id, to.id)
        if (currentId.current === fileId) {
          setTextComparison({
            rowKey,
            status: 'done',
            from: { number: numbers.from, content: data.from.content },
            to: { number: numbers.to, content: data.to.content },
          })
        }
      } catch {
        if (currentId.current === fileId) setTextComparison({ rowKey, status: 'failed' })
      }
    },
    [client, file.id],
  )

  if (!showsRevisionsSection({ facts, versionCount: file.versionCount, hasViewer: viewer !== undefined })) return null
  if (viewer !== undefined && loading && listing === null) {
    return <Skeleton className={cn('h-16 w-full rounded-surface', className)} />
  }

  const newestRead = documentReadFamily(file.status)
  const rows = buildRevisionTimeline({
    versions,
    publishedVersionId: listing?.publishedVersionId ?? null,
    history,
    directIds,
    headAt: file.createdAt ?? null,
    newer: supersededBy,
    newestRead,
    predecessorStandsIn: file.authoredBy !== 'agent',
  })
  rowsRef.current = rows
  const standing = revisionStanding({
    rows,
    newest,
    lifecycle,
    reviewerUserIds: listing?.reviewerUserIds ?? [],
    viewer,
    newestRead,
  })

  const listedNames = new Map((listing?.people ?? []).map((person) => [person.userId, person.name]))
  const assigneeNames = new Map(Object.entries(names ?? {}))
  const candidateNames = new Map(reviewers.map((person) => [person.userId, person.name]))
  const person = (userId: string | null) =>
    resolvePerson(userId, viewer?.userId, listedNames, assigneeNames, candidateNames)

  const actLine = (act: VersionAct): string => {
    const key = act.key === 'uploaded' && file.authoredBy === 'agent' ? 'created' : act.key
    const who = person(act.actor)
    const name =
      who.kind === 'you' ? t('preview.revision.rail.byYou') : who.kind === 'name' ? who.name : t('preview.revision.rail.bySomeone')
    return t('preview.revision.rail.act', {
      act: t(`lifecycle.versions.${key}`),
      name: keepTogether(`${name} · ${formatDate(act.when, locale)}`),
    })
  }
  const uploadedOn = (when: string | null): string[] =>
    when
      ? [t('preview.revision.rail.actAnonymous', { act: t('lifecycle.versions.uploaded'), date: formatDate(when, locale) })]
      : []

  const tagText = (tag: RevisionTag | null): string | null =>
    tag === null ? null : tag.kind === 'index' ? tag.text : t('preview.revision.rail.dateTag', { date: tag.text })
  const numberLabel = (number: number) => t('preview.revision.rail.number', { number })
  const ownTag = tagText(revisionTag(file.filename, file.revisionFacts))

  const changeCaption = changeCaptionFor(changeSummary, rows, t)
  const firstChangeKey = rows.find((row) => rowChange(row, changeSummary) !== null)?.key ?? null

  const showTimeline = rows.length > 1 || rows.some((row) => rowHasContent(row, changeSummary !== null))
  const offersApprove =
    viewer !== undefined && listing !== null && availableLifecycleGestures(newest, lifecycle, viewer).includes('approve')

  const textComparisonRow = (row: TimelineRow) =>
    textComparison?.rowKey === row.key ? <TextComparisonView comparison={textComparison} /> : null

  const renderVersionRow = (row: VersionRow, index: number): JSX.Element => {
    const { version } = row
    const everArrived = version.state === 'published' || version.state === 'superseded'
    const openable = version.bytesReadable !== false
    const acts = row.newest && versionActs(version).length > 0 ? versionActs(version) : [latestAct(version)]
    const predecessorNumber = row.predecessor ? numberOfVersion(rows, row.predecessor.id) : null
    const menu: ActionMenuEntry[] = []
    if (!row.current && everArrived && openable) {
      menu.push({
        type: 'item',
        id: 'download',
        label: t('preview.revision.versions.download'),
        href: versionFileUrl(file.id, version.id, { download: true }),
        download: true,
        testId: 'revision-version-download',
      })
    }
    if (row.predecessor && predecessorNumber !== null && openable && row.predecessor.bytesReadable !== false) {
      const predecessor = row.predecessor
      menu.push({
        type: 'item',
        id: 'compare-text',
        label: t('preview.revision.versions.compareText', { number: predecessorNumber }),
        disabled: textComparison?.rowKey === row.key && textComparison.status === 'loading',
        onSelect: () => void compareText(row.key, predecessor, version, { from: predecessorNumber, to: row.number }),
        testId: 'document-version-compare',
      })
    }
    const change = rowChange(row, changeSummary)
    return (
      <RevisionTimelineRow
        key={row.key}
        label={numberLabel(row.number)}
        tag={row.newest ? ownTag : null}
        marker={row.current ? t('preview.revision.current') : null}
        badge={
          !row.newest && NOTABLE_ROW_STATES.has(version.state) ? (
            <DocumentVersionStateBadge versionState={version.state} always className="bg-background" />
          ) : null
        }
        newest={index === 0}
        acts={acts.map(actLine)}
        comment={version.reviewComment}
        changeCaption={change ? changeCaption : null}
        change={change}
        changeHint={row.key === firstChangeKey ? t('preview.revision.changeHint') : null}
        changeTestId="revision-change"
        last={index === rows.length - 1}
        dataset={{ kind: 'version', version: String(version.versionNumber), state: version.state, number: String(row.number) }}
        action={
          row.current || !openable ? null : (
            <RowAction asChild>
              <a
                href={everArrived ? versionFileUrl(file.id, version.id) : versionContentUrl(file.id, version.id)}
                target="_blank"
                rel="noreferrer"
                data-testid="revision-version-open"
              >
                {t('preview.revision.versions.open')}
              </a>
            </RowAction>
          )
        }
        menu={menu}
        menuLabel={t('preview.revision.rail.rowMenu', { number: row.number })}
      >
        {version.mailOrigins && version.mailOrigins.length > 0 && (
          <MailOriginLine origins={version.mailOrigins} onOpen={projectId ? openMailOrigin : undefined} />
        )}
        {textComparisonRow(row)}
      </RevisionTimelineRow>
    )
  }

  const renderHeadRow = (row: HeadRow, index: number): JSX.Element => (
    <RevisionTimelineRow
      key={row.key}
      label={numberLabel(row.number)}
      tag={ownTag}
      marker={row.current ? t('preview.revision.current') : null}
      newest={index === 0}
      acts={uploadedOn(row.at)}
      changeCaption={changeSummary ? changeCaption : null}
      change={changeSummary?.text ?? null}
      changeHint={row.key === firstChangeKey ? t('preview.revision.changeHint') : null}
      changeTestId="revision-change"
      last={index === rows.length - 1}
      dataset={{ kind: 'head', number: String(row.number) }}
    />
  )

  const compareEntry = (older: { id: string; filename: string }, newer: { id: string; filename: string }): ActionMenuEntry => ({
    type: 'item',
    id: 'compare',
    label: t('preview.revision.compare'),
    onSelect: () => openRevisionCompare(older, newer),
    testId: 'revision-compare',
  })

  const openAction = (documentId: string) =>
    onOpenDocument ? (
      <RowAction onClick={() => onOpenDocument(documentId)} data-testid="revision-open">
        {t('preview.revision.open')}
      </RowAction>
    ) : null

  const previousKey = rows.find((candidate) => candidate.kind === 'linked')?.key ?? null

  const renderLinkedRow = (row: LinkedRow, index: number): JSX.Element => {
    const { entry } = row
    const menu: ActionMenuEntry[] = [compareEntry({ id: entry.id, filename: entry.filename }, { id: file.id, filename: file.filename })]
    if (canManage && row.direct) {
      menu.push({
        type: 'item',
        id: 'unlink',
        label: t('preview.revision.unlink'),
        disabled: busy,
        onSelect: () => void decide(entry.id, false),
        testId: 'revision-unlink',
      })
    }
    return (
      <RevisionTimelineRow
        key={row.key}
        label={numberLabel(row.number)}
        tag={tagText(revisionTag(entry.filename))}
        newest={index === 0}
        filename={entry.filename}
        filenameTail={distinguishingTailLength(entry.filename, file.filename)}
        acts={uploadedOn(entry.createdAt)}
        change={entry.changeSummary}
        changeHint={row.key === firstChangeKey ? t('preview.revision.changeHint') : null}
        last={index === rows.length - 1}
        dataset={{ kind: 'linked', id: entry.id, number: String(row.number) }}
        action={
          row.key === previousKey ? (
            <>
              <RowAction
                onClick={() => openRevisionCompare({ id: entry.id, filename: entry.filename }, { id: file.id, filename: file.filename })}
                data-testid="revision-compare-previous"
              >
                {t('preview.revision.compare')}
              </RowAction>
              {openAction(entry.id)}
            </>
          ) : (
            openAction(entry.id)
          )
        }
        menu={menu}
        menuLabel={t('preview.revision.rail.rowMenu', { number: row.number })}
      >
        {textComparisonRow(row)}
      </RevisionTimelineRow>
    )
  }

  const renderNewerRow = (row: NewerRow, index: number): JSX.Element => (
    <RevisionTimelineRow
      key={row.key}
      label={numberLabel(row.number)}
      tag={tagText(revisionTag(row.ref.filename))}
      marker={t('preview.revision.current')}
      newest={index === 0}
      filename={row.ref.filename}
      filenameTail={distinguishingTailLength(row.ref.filename, file.filename)}
      last={index === rows.length - 1}
      dataset={{ kind: 'newer', id: row.ref.id, number: String(row.number) }}
      action={openAction(row.ref.id)}
      menu={[compareEntry({ id: file.id, filename: file.filename }, { id: row.ref.id, filename: row.ref.filename })]}
      menuLabel={t('preview.revision.rail.rowMenu', { number: row.number })}
    >
      {textComparisonRow(row)}
    </RevisionTimelineRow>
  )

  const renderRow = (row: TimelineRow, index: number): JSX.Element => {
    if (row.kind === 'version') return renderVersionRow(row, index)
    if (row.kind === 'head') return renderHeadRow(row, index)
    if (row.kind === 'newer') return renderNewerRow(row, index)
    return renderLinkedRow(row, index)
  }

  const headerAct = !showTimeline && newest ? actLine(latestAct(newest)) : null

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('flex flex-col gap-2', className)}
      data-testid="document-revisions"
      data-attention={attention || undefined}
      asChild
    >
      <section aria-label={t('lifecycle.title')}>
        {/* The heading IS the trigger: a disclosure whose label is not the thing
            you press has a second target for the same job. */}
        {/* The same header line as every other section of the rail
            (`InspectorSection`): inset to the groups' content edge.
            `[text-transform:inherit]` because the preflight resets a button's
            case, so the trigger follows whatever case the eyebrow sets rather
            than drifting from the other section heads. */}
        <SectionLabel as="h3" className="px-3">
          <CollapsibleTrigger asChild>
            <button data-attr="document-revisions-toggle"
              type="button"
              className="touch-target duration-snap hover:text-foreground focus-visible:ring-ring flex min-h-5 w-full items-center gap-1.5 text-left tracking-[inherit] transition-colors ease-out outline-none [text-transform:inherit] focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
              data-testid="document-revisions-toggle"
            >
              <History className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{t('lifecycle.title')}</span>
              <span className="flex-1" />
              <ChevronDown
                aria-hidden
                className={cn(
                  'duration-quick size-3.5 shrink-0 transition-transform ease-out motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
        </SectionLabel>

        {/* ONE region, divided by what each part asks: where the document
            stands, the decision, Piloti's suggestion, the history, and the
            one-way door. They used to run together as one undivided column
            that widened into a card only while something was asked, so the
            section changed material, and width, under the reader's eye.
            Attention is now the group's stronger edge, and the decision's
            own primary button. */}
        <InspectorGroup
          className={cn(
            '[&>*+*]:border-border/60 [&>*+*]:border-t',
            attention && 'border-foreground/20 shadow-xs',
          )}
        >
        {/* Outside the content, on purpose: this is what the section says when
            it is shut, and it is the reason somebody opens it. */}
        <div className="p-3">
          <RevisionHeader standing={standing} person={person} headerAct={headerAct} />
        </div>

        {/* `empty:hidden`: open with nothing to say (no viewer, no suggestion,
            a lone Fassung) it would still take the group's hairline above it
            and draw a second rule along the group's foot. */}
        <CollapsibleContent className="[&>*+*]:border-border/60 [&>*+*]:border-t empty:hidden">
          {viewer !== undefined && listing !== null && newest !== null && (
            <div className="space-y-1.5 p-3">
              <DocumentReviewControls
                version={newest}
                lifecycle={lifecycle}
                viewer={viewer}
                pending={pending}
                onAct={(gesture, options) => void act(gesture, options)}
                reviewers={reviewers}
                revisionNumber={standing.number ?? undefined}
                publishBare
                openMarks={openMarks}
                actingName={viewer.userId ? (assigneeNames.get(viewer.userId) ?? listedNames.get(viewer.userId) ?? null) : null}
              />
              {offersApprove && (
                <p className="text-muted-foreground text-[11px] leading-snug" data-testid="revision-approve-explain">
                  {t('preview.revision.rail.approveExplain')}
                </p>
              )}
            </div>
          )}

          {suggestion && (
            <div className="p-3">
            <SuggestionNotice
              suggestion={suggestion}
              canManage={canManage}
              busy={busy}
              onDecide={(id, linked) => void decide(id, linked)}
            />
            </div>
          )}

          {failed && listing === null && (
            <p className="text-muted-foreground p-3 text-xs" data-testid="document-lifecycle-failed">
              {t('lifecycle.errors.loadFailed')}
            </p>
          )}

          {showTimeline && (
            <ol className="flex flex-col p-3" data-testid="revision-timeline" aria-label={t('preview.revision.timeline')}>
              {rows.map(renderRow)}
            </ol>
          )}

          {/* Last, and quiet: the item-level one-way door. One line here; its
              confirm says everything it does before it does it. */}
          {viewer !== undefined && listing !== null && canArchiveDocument(listing.lifecycle, viewer) && (
            <div className="px-3 py-1.5">
            {/* The group's hairline is the divider here, so the action's own
                top rule (`border-t`, for where it stands alone) is taken off. */}
            <DocumentArchiveAction
              compact
              className="border-t-0 pt-0"
              filename={file.filename}
              pending={pending === 'archive'}
              onArchive={() => void act('archive')}
            />
            </div>
          )}
        </CollapsibleContent>
        </InspectorGroup>
        {compareElement}
      </section>
    </Collapsible>
  )
}

function RevisionHeader({
  standing,
  person,
  headerAct,
}: {
  standing: RevisionStanding
  person: (userId: string | null) => ReturnType<typeof resolvePerson>
  headerAct: string | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const stageLabels = STAGE_LABEL_KEYS.map((key) => t(key))
  const { progress, stage } = standing
  return (
    <div className="space-y-1.5" data-testid="revision-header">
      <p className="text-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
        {standing.number !== null && (
          <span className="font-medium" data-testid="revision-header-label">
            {t('preview.revision.rail.number', { number: standing.number })}
          </span>
        )}
        {standing.state && (
          <DocumentVersionStateBadge
            versionState={standing.state === 'archived' ? null : standing.state}
            lifecycle={standing.state === 'archived' ? 'archived' : 'active'}
            always
            className="bg-background"
            testId="document-lifecycle-state"
          />
        )}
      </p>
      {progress && stage !== null && (
        <div data-testid="document-lifecycle-position">
          <StageTrack
            stages={LIFECYCLE_STAGES}
            reached={progress.reached}
            halted={progress.halted}
            tone={progress.tone}
            labels={stageLabels}
            current={stage}
            data-testid="document-lifecycle-track"
          />
          <span className="sr-only">
            {t('preview.revision.rail.stepOf', { step: stage + 1, total: LIFECYCLE_STAGES.length, stage: stageLabels[stage] })}
          </span>
        </div>
      )}
      {standing.nextStep && (
        <p className="text-foreground text-xs leading-snug" data-testid="revision-next-step" data-step={standing.nextStep.kind}>
          {nextStepText(standing.nextStep, person, t, locale)}
        </p>
      )}
      <p className="text-muted-foreground text-xs leading-snug" data-testid="revision-answer" data-answer={standing.answer.kind}>
        {answerText(standing, t)}
      </p>
      {headerAct && (
        <p className="text-muted-foreground text-xs leading-snug" data-testid="revision-header-act">
          {headerAct}
        </p>
      )}
    </div>
  )
}

const NEXT_STEP_KEYS: Record<NextStep['kind'], { who: string; you: string }> = {
  approve: { who: 'next.approve', you: 'next.approveYou' },
  revise: { who: 'next.revise', you: 'next.reviseYou' },
  submit: { who: 'next.submit', you: 'next.submitYou' },
  publish: { who: 'next.publish', you: 'next.publishYou' },
}

function nextStepText(
  step: NextStep,
  person: (userId: string | null) => ReturnType<typeof resolvePerson>,
  t: Translator,
  locale: string,
): string {
  const keys = NEXT_STEP_KEYS[step.kind]
  const rail = (key: string, params?: Record<string, string | number>) => t(`preview.revision.rail.${key}`, params)
  if (step.you) return rail(keys.you)
  if (step.kind === 'publish') return rail(keys.who)
  if (step.people.length === 0) return step.kind === 'approve' ? rail('next.approveOpen') : rail(keys.who, { who: rail('someone') })
  const named = [
    ...new Set(
      step.people.map((userId) => {
        const who = person(userId)
        return keepTogether(who.kind === 'name' ? who.name : rail('someone'))
      }),
    ),
  ]
  const who =
    named.length > 2
      ? rail('whoMore', { names: named[0] ?? '', count: named.length - 1 })
      : new Intl.ListFormat(locale, { type: 'disjunction' }).format(named)
  return rail(keys.who, { who })
}

function answerText(standing: RevisionStanding, t: Translator): string {
  const { answer } = standing
  switch (answer.kind) {
    case 'older':
    case 'newer':
      return t(`preview.revision.rail.answer.${answer.kind}`, { number: answer.number })
    case 'retired':
      return t('lifecycle.meaning.archived')
    default:
      return t(`preview.revision.rail.answer.${answer.kind}`)
  }
}

function keepTogether(text: string): string {
  return text.replace(/ /g, '\u00a0')
}

function rowChange(row: TimelineRow, summary: RevisionLinks['changeSummary']): string | null {
  if (row.kind === 'linked') return row.entry.changeSummary
  if (row.kind === 'head' || (row.kind === 'version' && row.newest)) return summary?.text ?? null
  return null
}

function changeCaptionFor(summary: RevisionLinks['changeSummary'], rows: readonly TimelineRow[], t: Translator): string | null {
  if (summary === null) return null
  const basis = summary.basis
  const against =
    basis === 'previous'
      ? rows.find((row) => row.kind === 'linked' && row.direct)
      : rows.find((row) => row.kind === 'linked' && row.entry.id === basis.id)
  if (against) return t('preview.revision.rail.changedSince', { number: against.number })
  return basis === 'previous'
    ? t('preview.revision.changedSincePrevious')
    : t('preview.revision.changedSince', { name: basis.filename })
}

function rowHasContent(row: TimelineRow, hasChange: boolean): boolean {
  if (row.kind === 'version') {
    return isPendingVersion(row.version) || Boolean(row.version.reviewComment) || (row.newest && hasChange)
  }
  if (row.kind === 'head') return hasChange
  return true
}
