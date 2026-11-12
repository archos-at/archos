'use client'

/**
 * Platform norm catalog (ADR-0016 companion) — the curated pointers to Austrian
 * building law the agent cites.
 *
 * Built on the shared admin primitives: SectionCard chrome, a DataToolbar
 * (search + rank / scope / open-review filters), a Table of entries, and a
 * Sheet holding the editor for the one entry in hand. The editor itself is a
 * guided flow and lives in `./norm-entry-editor`.
 *
 * Read-only since the cut-over (ADR-0175): a norm reaches offices only through
 * a reviewed change request (ADR-0165), so the registry takes no edits (its
 * route answers 409) and this view says where norms change now. The view and
 * its route go with the contract step that drops `norm_registry`.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BadgeCheck,
  BookMarked,
  CircleAlert,
  ClipboardList,
  Lock,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataToolbar } from '@/components/ui/data-toolbar'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import {
  isStale,
  NormEntryEditor,
} from '@/features/platform/components/norm-entry-editor'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import {
  NORM_RANKS,
  type NormEntry,
  type NormRegistryEnvelope,
} from '@/lib/norms/schemas'

/* ---------------------------------------------------------------------------
 * Constants + helpers
 * ------------------------------------------------------------------------- */

const PAGE_SIZE = 10

/** Sentinel filter values — '' is a real scope (federal law), so it cannot mean "all". */
const ALL = '__all__'
const FEDERAL = '__federal__'

/** Host of a plain source URL, e.g. 'www.wien.gv.at', or '' when unparseable. */
function sourceHost(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).host
  } catch {
    return trimmed
  }
}

const hasReview = (entry: NormEntry): boolean => (entry.review_note ?? '').trim().length > 0

/**
 * Legal lane of an entry, as a sort key. The old surface rendered one section
 * per lane; the table keeps that reading order (federal law, then the states
 * alphabetically, then authority information, then external norms) while the
 * rank and scope columns carry the label that the section heading used to.
 */
function laneOrder(entry: NormEntry): number {
  if (entry.rank === 'authority_info') return 2
  if (entry.rank === 'external_standard') return 3
  return entry.federal_state.trim() ? 1 : 0
}

function compareEntries(a: NormEntry, b: NormEntry): number {
  const lane = laneOrder(a) - laneOrder(b)
  if (lane !== 0) return lane
  const federalState = a.federal_state.trim().localeCompare(b.federal_state.trim(), 'de')
  if (federalState !== 0) return federalState
  return a.short.localeCompare(b.short, 'de')
}

function matchesQuery(entry: NormEntry, query: string): boolean {
  if (!query) return true
  const haystack = [
    entry.id,
    entry.short,
    entry.title,
    entry.document_number,
    entry.federal_state,
    entry.application,
    ...entry.topics,
    ...entry.aliases,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

/* ---------------------------------------------------------------------------
 * Main component
 * ------------------------------------------------------------------------- */

export function NormRegistry(): JSX.Element {
  const t = useTranslations(platformCopy)
  const [entries, setEntries] = useState<NormEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  /** Set once a load landed: a later reload (after a conflict) keeps the table. */
  const [hasLoaded, setHasLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [editor, setEditor] = useState<NormEntry | null>(null)

  const [query, setQuery] = useState('')
  const [rankFilter, setRankFilter] = useState<string>(ALL)
  const [scopeFilter, setScopeFilter] = useState<string>(ALL)
  const [onlyReviews, setOnlyReviews] = useState(false)
  const [offset, setOffset] = useState(0)

  const load = useCallback(() => {
    setIsLoading(true)
    setHasError(false)
    return fetch('/api/platform/norms')
      .then((r) => {
        if (!r.ok) throw new Error(`Load failed (${r.status})`)
        return r.json() as Promise<NormRegistryEnvelope>
      })
      .then((data) => {
        setEntries(data.registry.entries)
        setHasLoaded(true)
      })
      .catch(() => {
        setEntries([])
        setHasLoaded(false)
        setHasError(true)
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])


  const openReviewCount = useMemo(() => entries.filter(hasReview).length, [entries])

  const scopes = useMemo(() => {
    const federalStates = new Set<string>()
    for (const entry of entries) {
      const federalState = entry.federal_state.trim()
      if (federalState) federalStates.add(federalState)
    }
    return [...federalStates].sort((a, b) => a.localeCompare(b, 'de'))
  }, [entries])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...entries]
      .filter((entry) => {
        if (rankFilter !== ALL && entry.rank !== rankFilter) return false
        if (scopeFilter === FEDERAL && entry.federal_state.trim() !== '') return false
        if (
          scopeFilter !== ALL &&
          scopeFilter !== FEDERAL &&
          entry.federal_state.trim() !== scopeFilter
        ) {
          return false
        }
        if (onlyReviews && !hasReview(entry)) return false
        return matchesQuery(entry, needle)
      })
      .sort(compareEntries)
  }, [entries, query, rankFilter, scopeFilter, onlyReviews])

  // Deleting or filtering can strand the offset past the end of the list.
  const safeOffset = offset >= filtered.length ? 0 : offset
  const page = filtered.slice(safeOffset, safeOffset + PAGE_SIZE)

  const resetPaging = useCallback(() => setOffset(0), [])

  const registryEmpty = !isLoading && !hasError && entries.length === 0

  return (
    <>
      <SectionCard
        testId="norm-registry"
        // Titled by what it holds: the page header above already says
        // "norm catalog", and the count is the fact worth a heading.
        title={
          entries.length === 1
            ? t('norms.entryCountOne')
            : t('norms.entryCount', { count: entries.length })
        }
        description={t('norms.description')}
        loading={isLoading && !hasLoaded}
        refreshing={isLoading && hasLoaded}
        error={!isLoading && hasError}
        errorMessage={t('norms.loadError')}
        onRetry={() => void load()}
        empty={registryEmpty}
        emptyIcon={BookMarked}
        emptyTitle={t('norms.empty.title')}
        emptyDescription={t('norms.empty.description')}
      >
        <div className="flex flex-col gap-3">
          <Alert data-testid="norm-registry-retired">
            <Lock aria-hidden />
            <AlertDescription className="flex flex-col gap-2">
              <span>{t('norms.retired')}</span>
              <Link href="/app/platform/countries" className="w-fit underline underline-offset-2">
                {t('norms.retiredLink')}
              </Link>
            </AlertDescription>
          </Alert>

          <DataToolbar
            searchValue={query}
            onSearchChange={(value) => {
              setQuery(value)
              resetPaging()
            }}
            searchPlaceholder={t('norms.search.placeholder')}
            searchLabel={t('norms.search.label')}
            clearLabel={t('norms.search.clear')}
            filters={
              <>
                <Select
                  value={rankFilter}
                  onValueChange={(value) => {
                    setRankFilter(value)
                    resetPaging()
                  }}
                >
                  <SelectTrigger size="sm" className="w-44 [&>span]:min-w-0 [&>span]:truncate" aria-label={t('norms.filters.rank')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('norms.filters.allRanks')}</SelectItem>
                    {NORM_RANKS.map((rank) => (
                      <SelectItem key={rank} value={rank}>
                        {t(`norms.rankShort.${rank}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={scopeFilter}
                  onValueChange={(value) => {
                    setScopeFilter(value)
                    resetPaging()
                  }}
                >
                  <SelectTrigger size="sm" className="w-40 [&>span]:min-w-0 [&>span]:truncate" aria-label={t('norms.filters.scope')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('norms.filters.allScopes')}</SelectItem>
                    <SelectItem value={FEDERAL}>{t('norms.federal')}</SelectItem>
                    {scopes.map((federalState) => (
                      <SelectItem key={federalState} value={federalState}>
                        {federalState}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {openReviewCount > 0 && (
                  // The old surface kept a separate "open reviews" queue card.
                  // As a filter it stays one click away without duplicating the
                  // list — and the count is still visible without opening it.
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-pressed={onlyReviews}
                    className="aria-pressed:bg-selected aria-pressed:hover:bg-selected"
                    onClick={() => {
                      setOnlyReviews((prev) => !prev)
                      resetPaging()
                    }}
                  >
                    <ClipboardList className="size-3.5" aria-hidden />
                    {t('norms.filters.reviews', { count: openReviewCount })}
                  </Button>
                )}
              </>
            }
          />

          {filtered.length === 0 ? (
            <EmptyState
              variant="bare"
              icon={BookMarked}
              title={t('norms.noMatches.title')}
              description={t('norms.noMatches.description')}
            />
          ) : (
            // No second border: the card is the container, and a bordered
            // table inside it read as a card in a card.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('norms.columns.norm')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('norms.columns.rank')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('norms.columns.scope')}</TableHead>
                  <TableHead>{t('norms.columns.verified')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.map((entry) => (
                  <NormRow
                    key={entry.id}
                    entry={entry}
                    t={t}
                    onOpen={() => setEditor(entry)}
                  />
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination
            offset={safeOffset}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onOffsetChange={setOffset}
            rangeLabel={(from, to, total) => t('norms.pagination.range', { from, to, total })}
            previousLabel={t('norms.pagination.previous')}
            nextLabel={t('norms.pagination.next')}
          />
        </div>
      </SectionCard>

      <Sheet open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <SheetContent className="sm:max-w-xl" closeLabel={t('norms.sheet.close')}>
          {editor && (
            // Read-only: the editor offers only Close, so its save and delete never run.
            <NormEntryEditor
              key={editor.id}
              entry={editor}
              originalId={editor.id}
              existingIds={new Set()}
              onSave={() => undefined}
              onCancel={() => setEditor(null)}
              onRequestDelete={() => undefined}
              isNew={false}
              readOnly
              t={t}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

/* ---------------------------------------------------------------------------
 * Table row
 * ------------------------------------------------------------------------- */

function NormRow({
  entry,
  onOpen,
  t,
}: {
  entry: NormEntry
  /** Opens the editor; absent for a viewer who cannot save, so the row is plain text. */
  onOpen?: () => void
  t: Translator
}): JSX.Element {
  const stale = isStale(entry.verified_at)
  const review = (entry.review_note ?? '').trim()
  const scope = entry.federal_state.trim() || t('norms.federal')
  const document = entry.document_number
    ? [entry.application, entry.document_number].filter(Boolean).join(' · ')
    : sourceHost(entry.source_url) || t('norms.row.noFullText')

  const summary = (
    <>
      <span className="flex items-center gap-2">
        <Badge variant="secondary" className="shrink-0">
          {entry.short}
        </Badge>
        {review ? (
          <ClipboardList
            className="text-warning size-3.5 shrink-0"
            aria-label={t('norms.row.review')}
          />
        ) : null}
      </span>
      <span className="line-clamp-2 text-sm font-medium">{entry.title}</span>
      {/* The document pointer rides in the norm cell rather than a column of
          its own: a nowrap identifier column pushed the verification badge
          off the card at every width this page renders at. */}
      <span className="text-muted-foreground break-all font-mono text-xs">{document}</span>
      {/* Rank and scope have their own columns from `sm`/`md`; below that
          they ride under the title so a phone still sees them. */}
      <span className="text-muted-foreground block text-xs md:hidden">
        <span className="sm:hidden">{t(`norms.rankShort.${entry.rank}`)} · </span>
        {scope}
      </span>
      {review ? <span className="text-warning line-clamp-2 text-xs">{review}</span> : null}
    </>
  )

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('norms.row.open', { title: entry.title })}
            className="pointer-coarse:min-h-11 focus-visible:ring-ring/60 flex w-full flex-col items-start gap-0.5 text-left hover:underline focus-visible:outline-none focus-visible:ring-2"
          >
            {summary}
          </button>
        ) : (
          <div className="flex flex-col items-start gap-0.5">{summary}</div>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant="outline">{t(`norms.rankShort.${entry.rank}`)}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground hidden text-sm md:table-cell">{scope}</TableCell>
      <TableCell>
        <Badge
          variant={stale ? 'warning' : 'outline'}
          className="gap-1"
          title={stale ? t('norms.row.staleHint') : t('norms.row.verifiedHint')}
        >
          {stale ? (
            <CircleAlert className="size-3" aria-hidden />
          ) : (
            <BadgeCheck className="size-3" aria-hidden />
          )}
          <span className="tabular-nums">
            {entry.verified_at.trim() || t('norms.row.unverified')}
          </span>
        </Badge>
      </TableCell>
    </TableRow>
  )
}
