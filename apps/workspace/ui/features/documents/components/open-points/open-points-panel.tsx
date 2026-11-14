'use client'

/**
 * A project's Offene Punkte: the open Anmerkungen of every document of the
 * project on one page, grouped by document, for the Jour fixe, which is held
 * per project and not per sheet. Reached from the Dateien header, as the
 * Papierkorb is.
 *
 * Each row is the review list's own (`MarkRowContent`), as a link into that
 * document's Prüfansicht at the mark (`reviewFilesHref`: Dateien with `doc`,
 * `review` and `mark`, which the pane already answers). The filters are the
 * Jour fixe's two questions, whose points are mine and what is due; the
 * Protokoll carries what the filters show.
 *
 * The filters are in the page's address (`assignee=me`, `due=…`, replaced
 * without a server render), and every link into a review carries that
 * address as `back`: closing the review returns here, to the same selection,
 * rather than leaving the reader in Dateien. The list is read again when the
 * page comes back (`useProjectMarks`).
 */

import { useState, type JSX } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { AlertTriangle, Check, CheckCheck, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadMore } from '@/components/ui/load-more'
import { ProjectSectionActions } from '@/components/shell/project-section-frame'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import {
  ASSIGNEE_ME,
  PROJECT_MARK_DUE,
  type ProjectMarkDue,
  type ProjectMarksFilters,
  type ProjectMarksResponse,
  type ProjectMarkView,
} from '@/lib/annotations/project-types'
import { useProjectMarks } from '../../hooks/use-project-marks'
import { reviewFilesHref } from '../../lib/open-review'
import { MarkRowContent, markRowClassName } from '../review/mark-row'
import { ProjectProtocolMenu } from './project-protocol-menu'

type AssigneeChoice = 'all' | 'me'
type DueChoice = 'all' | ProjectMarkDue

/** The filters the page opens with, and the server reads its first page for. */
export const OPEN_POINTS_DEFAULT_FILTERS: ProjectMarksFilters = {}

const filtersOf = (assignee: AssigneeChoice, due: DueChoice): ProjectMarksFilters => ({
  ...(assignee === 'me' ? { assignee: ASSIGNEE_ME } : {}),
  ...(due === 'all' ? {} : { due }),
})

/** The filters the page's address names; anything else is the default. */
function choicesOf(params: Pick<URLSearchParams, 'get'> | null): { assignee: AssigneeChoice; due: DueChoice } {
  const due = params?.get('due')
  return {
    assignee: params?.get('assignee') === ASSIGNEE_ME ? 'me' : 'all',
    due: due && (PROJECT_MARK_DUE as readonly string[]).includes(due) ? (due as ProjectMarkDue) : 'all',
  }
}

/**
 * The chips picked, as the two filters: „Für Sie“ on or off, and the one due chip, the newest when both are picked.
 * „Alle“ is picked exactly when nothing else is, and pressing it clears the rest.
 */
function choicesFromChips(
  next: readonly string[],
  previous: { assignee: AssigneeChoice; due: DueChoice }
): { assignee: AssigneeChoice; due: DueChoice } {
  const filtered = previous.assignee !== 'all' || previous.due !== 'all'
  if (filtered && next.includes(ALL_CHIP)) return { assignee: 'all', due: 'all' }
  const dues = next.filter((value): value is ProjectMarkDue => (PROJECT_MARK_DUE as readonly string[]).includes(value))
  return { assignee: next.includes('me') ? 'me' : 'all', due: dues.find((value) => value !== previous.due) ?? dues[0] ?? 'all' }
}

/** The chip that stands for no filter. */
const ALL_CHIP = 'all'

/**
 * This page's address with the filters on it, leaving out the defaults and
 * keeping any other param: the `back` of every link into a review.
 */
function hrefOf(pathname: string, current: string, assignee: AssigneeChoice, due: DueChoice): string {
  const params = new URLSearchParams(current)
  if (assignee === 'me') params.set('assignee', ASSIGNEE_ME)
  else params.delete('assignee')
  if (due !== 'all') params.set('due', due)
  else params.delete('due')
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** The marks by document, in the order the documents first appear (the list is ordered by document). */
function byDocument(marks: readonly ProjectMarkView[]): { documentId: string; documentName: string; marks: ProjectMarkView[] }[] {
  const groups = new Map<string, { documentId: string; documentName: string; marks: ProjectMarkView[] }>()
  for (const mark of marks) {
    const group = groups.get(mark.documentId) ?? { documentId: mark.documentId, documentName: mark.documentName, marks: [] }
    group.marks.push(mark)
    groups.set(mark.documentId, group)
  }
  return [...groups.values()]
}

export interface OpenPointsPanelProps {
  projectId: string
  /** The reader, so a mention of them stands out. */
  currentUserId: string | null
  /** The first page the server read for {@link OPEN_POINTS_DEFAULT_FILTERS}; null when that read failed. */
  initial: ProjectMarksResponse | null
  /** „Im Projekt ablegen": the project's name for the file, where the reader may file into the root; null, not offered. */
  filing?: { projectName: string } | null
}

export function OpenPointsPanel({ projectId, currentUserId, initial, filing = null }: OpenPointsPanelProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const pathname = usePathname() ?? `/app/projects/${projectId}/files/open-points`
  const searchParams = useSearchParams()
  const [assignee, setAssigneeState] = useState<AssigneeChoice>(() => choicesOf(searchParams).assignee)
  const [due, setDueState] = useState<DueChoice>(() => choicesOf(searchParams).due)
  const current = searchParams?.toString() ?? ''
  const here = hrefOf(pathname, current, assignee, due)
  /**
   * A filter changes the list and the address, so Back from a review comes back to it. The
   * address is replaced with `history.replaceState`, which Next's router follows (`useSearchParams`
   * reads it) without rendering the page on the server again: the list reads itself.
   */
  const choose = (next: { assignee: AssigneeChoice; due: DueChoice }) => {
    setAssigneeState(next.assignee)
    setDueState(next.due)
    window.history.replaceState(null, '', hrefOf(pathname, current, next.assignee, next.due))
  }
  const filters = filtersOf(assignee, due)
  const list = useProjectMarks(projectId, filters, { page: initial, filters: OPEN_POINTS_DEFAULT_FILTERS })
  const filtered = assignee !== 'all' || due !== 'all'
  const phone = useMediaQuery(PHONE_QUERY)

  return (
    <div className="h-full overflow-y-auto">
      {/* The listing's container and edges (1280px, 32px; 16px on a phone), as „Alle Dateien“: centred at 896px the
          tab had a left edge of its own. */}
      <div className="flex listing-container flex-col gap-6 px-4 pb-4 pt-2 md:gap-8 md:px-8" data-testid="open-points" /* 32px between sections (paper on a desk, principle 5); 24 on a phone */>
        {/* The title and the way back are the section frame's (`Dateien ›`); the protocol is this page's action. */}
        <ProjectSectionActions onTitleLine>
          <ProjectProtocolMenu
            projectId={projectId}
            filters={filters}
            filing={filing}
            restricted={list.load === 'ready' ? list.restricted : null}
            compact={phone}
          />
        </ProjectSectionActions>

        {/* The Jour fixe's two questions as one row of filter chips, „Alle“ picked while none of the others is. Two
            tracks each showing „Alle“, under the tabs' track, were three choices stacked where one row answers both;
            „Überfällig“ and „Bald“ exclude each other, „Für Sie“ goes with either. A chip is a 28px pill of the desk's
            fill, picked the selected grey and its tick: never the press's shape, never a thumb (a thumb lives on a track). */}
        <ToggleGroup
          type="multiple"
          value={filtered ? [...(assignee === 'me' ? ['me'] : []), ...(due === 'all' ? [] : [due])] : [ALL_CHIP]}
          onValueChange={(next) => choose(choicesFromChips(next, { assignee, due }))}
          variant="chip"
          size="sm"
          className="gap-2 [&>button]:text-name"
          aria-label={t('openPoints.filters.label')}
          data-testid="open-points-filters"
        >
          <ToggleGroupItem value={ALL_CHIP} data-testid="open-points-all">
            <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
            {t('openPoints.filters.all')}
          </ToggleGroupItem>
          <ToggleGroupItem value="me" data-testid="open-points-assignee-me">
            <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
            {t('openPoints.filters.me')}
          </ToggleGroupItem>
          <ToggleGroupItem value="overdue" data-testid="open-points-due-overdue">
            <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
            {t('openPoints.filters.overdue')}
          </ToggleGroupItem>
          <ToggleGroupItem value="soon" title={t('openPoints.filters.soonHint')} data-testid="open-points-due-soon">
            <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
            {t('openPoints.filters.soon')}
          </ToggleGroupItem>
        </ToggleGroup>

        {list.load === 'loading' ? (
          <div className="flex justify-center py-12" role="status" aria-label={t('openPoints.loading')}>
            <Spinner size="sm" />
          </div>
        ) : list.load === 'error' ? (
          <EmptyState
            variant="bare"
            icon={AlertTriangle}
            tone="destructive"
            title={t('openPoints.loadError')}
            action={
              <Button variant="secondary" size="sm" onClick={list.retry} data-testid="open-points-retry">
                <RefreshCw className="size-3.5" aria-hidden />
                {t('openPoints.retry')}
              </Button>
            }
          />
        ) : list.marks.length === 0 ? (
          <EmptyState variant="bare"
            icon={CheckCheck}
            title={t(filtered ? 'openPoints.empty.filteredTitle' : 'openPoints.empty.noneTitle')}
            description={t(filtered ? 'openPoints.empty.filteredBody' : 'openPoints.empty.noneBody')}
            data-testid="open-points-empty"
          />
        ) : (
          <>
            {byDocument(list.marks).map((group) => (
              // A document's points under its name, on the page: no box and no line under the heading. The rows bleed by
              // their inset, so the numbers stand on the edge under the document's glyph.
              <section key={group.documentId} aria-label={group.documentName} className="flex flex-col" data-testid="open-points-document">
                {/* The glyph on the column's edge in the points' 24px marker column, so the name stands on their text's
                    edge. A line as tall as its tonal press (32px, 44px under touch): an overhanging fill reached the first
                    point on a phone. */}
                <div className="flex min-h-8 items-center gap-3 pointer-coarse:min-h-11">
                  <span className="flex w-6 shrink-0 justify-start">
                    <FileText className="text-muted-foreground size-4" aria-hidden />
                  </span>
                  {/* The heading is the one action of the group: it opens the review. No second press beside it. */}
                  <h2 className="min-w-0 flex-1 text-section">
                    <Link
                      href={reviewFilesHref(projectId, { documentId: group.documentId }, { back: here })}
                      aria-label={t('openPoints.openReviewOf', { name: group.documentName })}
                      className="group/head inline-flex max-w-full items-center gap-1 rounded-control outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span className="truncate">{group.documentName}</span>
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </Link>
                  </h2>
                </div>
                <ul className="-mx-2.5 flex flex-col">
                  {group.marks.map((mark) => (
                    <li key={mark.id} className={ROW_HAIRLINE_MARKS}>
                      <Link
                        href={reviewFilesHref(
                          projectId,
                          { documentId: mark.documentId, annotationId: mark.id },
                          { back: here }
                        )}
                        className={cn(markRowClassName(), 'hover:bg-hover')}
                        data-testid="open-point-row"
                      >
                        <MarkRowContent annotation={mark} viewerId={currentUserId} showPage marker="verdict" columns />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <LoadMore
              hasMore={list.hasMore}
              loading={list.more === 'loading'}
              failed={list.more === 'error'}
              onLoadMore={list.loadMore}
              loadMoreLabel={t('openPoints.loadMore')}
              loadingLabel={t('openPoints.loadingMore')}
              failedLabel={t('openPoints.loadMoreFailed')}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** A hairline under each point, the one inset rule: from its text (10px row inset + 24px marker + 12px gap) to the row's end. */
const ROW_HAIRLINE_MARKS = `${ROW_HAIRLINE} [--row-text:46px] [--row-end:10px]`
