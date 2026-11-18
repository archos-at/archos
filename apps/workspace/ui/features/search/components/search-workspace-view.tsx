'use client'

import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, FilterX, Hourglass, List, SearchX, SlidersHorizontal, Table2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-error'
import { SearchField } from '@/components/ui/search-field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PHONE_QUERY, useIsMobile } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useLocale, useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { SEARCH_KINDS, type DocumentHit, type SearchFacetDimension, type SearchHit, type SearchKind, type SearchResponse } from '@/lib/search/search-wire'
import { clearFilters } from '../lib/active-filters'
import type { SearchExportFormat } from '../lib/search-client'
import { toggleFacet } from '../lib/search-facets'
import { hitHref } from '../lib/search-hrefs'
import { useSearchReturn } from '../hooks/use-search-return'
import { surfaceScope, type SearchSurface } from '../lib/search-surface'
import { activeFilterCount, filtersByReading, officeSearchHref, withView, type SearchUrlState, type SearchView } from '../lib/search-url'
import { kindCountsKnown, type SectionView } from '../lib/sections'
import { HitMenuProvider, type HitMenuState } from './hit-actions-menu'
import { SearchActiveFilters } from './search-active-filters'
import {
  ChoiceStrip,
  EmptyActions,
  FieldShortcut,
  FilterSheet,
  KeysHint,
  KindCount,
  ResultsBody,
  ResultsSkeleton,
  ResultsStatus,
  SearchFrame,
  SearchNote,
  SearchToolbar,
} from './search-atoms'
import { SearchExportMenu } from './search-export-menu'
import { SearchFacetRail } from './search-facet-rail'
import { CitesFilter, PartyNameFilter, SearchFilterForm, SearchKeyFilters } from './search-filter-form'
import { SearchRegister, SearchRegisterBar } from './search-register'
import { SearchResultList } from './search-result-list'

const ALL_KINDS = 'all'

export interface SearchWorkspaceViewProps {
  surface: SearchSurface
  state: SearchUrlState
  onStateChange: (next: SearchUrlState) => void
  fieldValue: string
  onFieldChange: (value: string) => void
  response: SearchResponse | null
  sections: Partial<Record<SearchKind, SectionView>>
  loading: boolean
  failed: boolean
  onRetry: () => void
  onLoadMore: (kind: SearchKind) => void
  onExport?: (format: SearchExportFormat) => void
  exporting?: boolean
  savedSearches?: ReactNode
  leading?: ReactNode
  currentUserId?: string
  autoFocus?: boolean
  filtersOpen?: boolean
}

function walkOrder(view: SearchView, sections: Partial<Record<SearchKind, SectionView>>): SearchHit[] {
  if (view === 'register') return sections.document?.hits ?? []
  return SEARCH_KINDS.flatMap((kind) => sections[kind]?.hits ?? [])
}

const hitKey = (hit: SearchHit): string => `${hit.kind}:${hit.id}`

export const isMenuKey = (event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean =>
  event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)

export function SearchWorkspaceView({
  surface,
  state,
  onStateChange,
  fieldValue,
  onFieldChange,
  response,
  sections,
  loading,
  failed,
  onRetry,
  onLoadMore,
  onExport,
  exporting = false,
  savedSearches,
  leading,
  currentUserId,
  autoFocus = false,
  filtersOpen = false,
}: SearchWorkspaceViewProps): JSX.Element {
  const t = useTranslations(searchCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const from = useSearchReturn()
  const sheetLayout = useIsMobile()
  const phone = useMediaQuery(PHONE_QUERY)
  const [sheetOpen, setSheetOpen] = useState(filtersOpen)
  const field = useRef<HTMLInputElement | null>(null)
  const filterCount = activeFilterCount(state)
  const officeWide = surface.kind === 'office'

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      event.stopImmediatePropagation()
      field.current?.focus()
      field.current?.select()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  useEffect(() => {
    if (autoFocus) field.current?.focus()
  }, [autoFocus])

  const order = useMemo(() => walkOrder(state.view, sections), [state.view, sections])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [fieldFocused, setFieldFocused] = useState(false)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const hitMenus = useMemo<HitMenuState>(() => ({ openKey: menuKey, onOpenKeyChange: setMenuKey }), [menuKey])
  const idPrefix = useId()
  const listId = (kind: SearchKind): string => `${idPrefix}-list-${kind}`
  const registerId = `${idPrefix}-register`
  const optionId = (hit: SearchHit): string => `${idPrefix}-${hitKey(hit).replace(':', '-')}`
  const activeHit = order.find((hit) => hitKey(hit) === activeKey)
  const controls =
    state.view === 'register' ? registerId : SEARCH_KINDS.filter((kind) => (sections[kind]?.hits.length ?? 0) > 0).map(listId).join(' ')
  const [seen, setSeen] = useState(response)
  if (seen !== response) {
    setSeen(response)
    setActiveKey(null)
  }

  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (order.length === 0) return
      event.preventDefault()
      const at = order.findIndex((hit) => hitKey(hit) === activeKey)
      const next = event.key === 'ArrowDown' ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1)
      setActiveKey(hitKey(order[next]))
      return
    }
    if (isMenuKey(event)) {
      const hit = order.find((entry) => hitKey(entry) === activeKey)
      if (hit?.kind !== 'document') return
      event.preventDefault()
      setMenuKey(hitKey(hit))
      return
    }
    if (event.key === 'Enter') {
      const hit = order.find((entry) => hitKey(entry) === activeKey)
      if (!hit) return
      event.preventDefault()
      router.push(hitHref(hit, from))
      return
    }
    if (event.key === 'Escape' && fieldValue !== '') {
      event.preventDefault()
      onFieldChange('')
    }
  }

  const projectName = (id: string): string | null =>
    response?.facets?.project?.find((facet) => facet.value === id)?.label ??
    (sections.document?.hits as DocumentHit[] | undefined)?.find((hit) => hit.projectId === id)?.projectName ??
    null

  const onFacet = (dimension: SearchFacetDimension, value: string): void => onStateChange(toggleFacet(state, dimension, value))
  const visibleSections = (state.view === 'register' ? [sections.document] : Object.values(sections)).filter(
    (section): section is SectionView => Boolean(section)
  )
  const anyHits = visibleSections.some((section) => section.hits.length > 0)
  const total = visibleSections.reduce((sum, section) => sum + section.total, 0)
  const lowerBound = visibleSections.some((section) => section.totalIsLowerBound)
  const documents = sections.document as SectionView<DocumentHit> | undefined
  const placeholder = phone ? t('field.placeholderShort') : t(`field.placeholder.${surface.kind}`)
  const building = response?.building.length ?? 0
  const oneKind = state.view === 'list' && state.kinds?.length === 1 ? state.kinds[0] : null
  const setAside = state.view === 'list' ? (response?.setAside ?? {}) : {}
  const kindTabs = SEARCH_KINDS.filter((kind) => officeWide || kind !== 'project')
  const countsKnown = kindCountsKnown(response, kindTabs)
  const setAsideNotes = (['document_filters', 'annotation_filters'] as const).flatMap((reason) => {
    const named = SEARCH_KINDS.filter((kind) => setAside[kind] === reason && (officeWide || kind !== 'project'))
    if (named.length === 0) return []
    const kinds = new Intl.ListFormat(locale, { type: 'conjunction' }).format(named.map((kind) => t(`kinds.${kind}`)))
    return [{ reason, long: t(`setAside.${reason}`, { kinds }), short: t('setAside.short', { kinds }) }]
  })
  const setAsideNote = setAsideNotes.map((note) => (phone ? note.short : note.long))

  const status = failed
    ? null
    : response === null || loading
      ? t('loading')
      : lowerBound
        ? t('summaryAtLeast', { count: total })
        : t('total', { count: total })
  const buildingNote = filtersByReading(state) && !phone ? 'notes.buildingFiltered' : 'notes.buildingShort'
  const statusLine = status && building > 0 && anyHits && !loading ? `${status} · ${t(buildingNote, { count: building })}` : status

  const rail = (
    <>
      <SearchKeyFilters state={state} onChange={onStateChange} />
      <SearchFacetRail
        state={state}
        facets={response?.facets ?? null}
        onToggle={onFacet}
        unread={response?.unread ?? null}
        showProjects={officeWide}
        extras={{ partyRole: <PartyNameFilter state={state} onChange={onStateChange} />, cites: <CitesFilter state={state} onChange={onStateChange} /> }}
      />
      <SearchFilterForm state={state} onChange={onStateChange} currentUserId={currentUserId} defaultOpen={filtersOpen} />
    </>
  )

  const emptyActions = [
    filterCount > 0 ? (
      <Button key="clear" type="button" variant="secondary" size="sm" onClick={() => onStateChange(clearFilters(state))} data-testid="search-empty-clear">
        {t('filters.clearAll')}
      </Button>
    ) : null,
    oneKind ? (
      <Button key="kinds" type="button" variant="secondary" size="sm" onClick={() => onStateChange({ ...state, kinds: null })} data-testid="search-empty-all-kinds">
        {t('empty.allKinds')}
      </Button>
    ) : null,
    state.filters.includeArchived ? null : (
      <Button
        key="archived"
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onStateChange({ ...state, filters: { ...state.filters, includeArchived: true } })}
        data-testid="search-empty-archived"
      >
        {t('empty.includeArchived')}
      </Button>
    ),
    officeWide ? null : (
      <Button key="office" asChild variant="secondary" size="sm">
        <Link href={officeSearchHref(state)} data-testid="search-empty-office">
          {t('empty.wholeOffice')}
        </Link>
      </Button>
    ),
  ].filter(Boolean)
  const emptyDescription =
    building > 0
      ? t('empty.reading', { count: building })
      : filterCount > 0
        ? t('empty.withFilters')
        : oneKind
          ? t('empty.oneKind', { kind: t(`kinds.${oneKind}`) })
          : t('empty.description')

  return (
    <SearchFrame
      rail={sheetLayout ? null : rail}
      toolbar={
        <>
          <SearchToolbar
            field={
              <SearchField
                type="search"
                value={fieldValue}
                onChange={onFieldChange}
                onKeyDown={onFieldKeyDown}
                onFocusChange={setFieldFocused}
                placeholder={placeholder}
                label={t('field.label')}
                clearLabel={t('field.clear')}
                inputRef={field}
                hint={<FieldShortcut />}
                combobox={{ controls, expanded: order.length > 0, activeDescendant: activeHit ? optionId(activeHit) : null }}
              />
            }
            controls={
              <>
                {leading}
                <ToggleGroup
                  type="single"
                  segmented
                  size="icon-sm"
                  value={state.view}
                  onValueChange={(value) => {
                    if (value === 'list' || value === 'register') onStateChange(withView(state, value as SearchView))
                  }}
                  aria-label={t('views.label')}
                >
                  <ToggleGroupItem value="list" aria-label={t('views.list')} title={t('views.list')} data-testid="search-view-list">
                    <List aria-hidden />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="register" aria-label={t('views.register')} title={t('views.register')} data-testid="search-view-register">
                    <Table2 aria-hidden />
                  </ToggleGroupItem>
                </ToggleGroup>
                {sheetLayout ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    onClick={() => setSheetOpen(true)}
                    data-testid="search-rail-toggle"
                  >
                    <SlidersHorizontal aria-hidden />
                    {filterCount > 0 ? t('filters.toggleCount', { count: filterCount }) : t('filters.toggle')}
                  </Button>
                ) : null}
                {savedSearches}
                {onExport && state.view === 'register' ? <SearchExportMenu onExport={onExport} busy={exporting} /> : null}
              </>
            }
          />
          <SearchActiveFilters state={state} onChange={onStateChange} projectName={projectName} />
          {sheetLayout ? (
            <FilterSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              title={t('filters.sheetTitle')}
              description={t('filters.sheetDescription')}
              closeLabel={t('filters.sheetClose')}
              clearLabel={t('filters.clearAllShort')}
              canClear={filterCount > 0}
              onClear={() => onStateChange(clearFilters(state))}
              showLabel={response === null || loading ? t('loading') : total > 0 ? t('filters.showResults', { count: total }) : t('filters.showNone')}
            >
              {rail}
            </FilterSheet>
          ) : null}
        </>
      }
    >
      {state.view === 'list' ? (
        <ChoiceStrip label={t('kindFilter.label')}>
          <ToggleGroup
            type="single"
            segmented
            size="sm"
            value={state.kinds?.length === 1 ? state.kinds[0] : ALL_KINDS}
            onValueChange={(value) => {
              if (value) onStateChange({ ...state, kinds: value === ALL_KINDS ? null : [value as SearchKind] })
            }}
            aria-label={t('kindFilter.label')}
            data-testid="search-kind"
          >
            <ToggleGroupItem value={ALL_KINDS}>{t('kindFilter.all')}</ToggleGroupItem>
            {kindTabs.map((kind) => {
              const section = countsKnown ? response?.sections[kind] : undefined
              const asideReason = setAside[kind]
              return (
                <ToggleGroupItem
                  key={kind}
                  value={kind}
                  disabled={Boolean(asideReason) && state.kinds?.[0] !== kind}
                  title={asideReason ? (setAsideNotes.find((note) => note.reason === asideReason)?.long ?? t('setAside.tab')) : undefined}
                  data-set-aside={asideReason}
                  data-testid={`search-kind-${kind}`}
                >
                  {t(`kinds.${kind}`)}
                  {section ? <KindCount>{section.totalIsLowerBound ? `${section.total}+` : section.total}</KindCount> : null}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </ChoiceStrip>
      ) : (
        <SearchRegisterBar state={state} onStateChange={onStateChange} hideProject={!officeWide} />
      )}
      <ResultsStatus busy={loading && !failed}>
        {statusLine}
        {status && anyHits && fieldFocused && activeKey === null ? <KeysHint>{` · ${t('keys')}`}</KeysHint> : null}
      </ResultsStatus>
      {setAsideNote.map((note) => (
        <SearchNote key={note} icon={FilterX} testId="search-note-set-aside">
          {note}
        </SearchNote>
      ))}
      {response?.contentPartial ? (
        <SearchNote icon={BookOpenCheck} testId="search-note-partial">
          {t('notes.contentPartial')}
        </SearchNote>
      ) : null}
      {failed ? (
        <LoadError title={t('error')} description={t('errorHint')} onRetry={onRetry} />
      ) : response === null ? (
        loading ? <ResultsSkeleton /> : null
      ) : !anyHits ? (
        <EmptyState
          icon={building > 0 ? Hourglass : SearchX}
          title={building > 0 ? t('empty.readingTitle') : t('empty.title')}
          description={emptyDescription}
          action={emptyActions.length > 0 ? <EmptyActions>{emptyActions}</EmptyActions> : undefined}
          variant="bare"
          data-testid="search-empty"
        />
      ) : (
        <ResultsBody stale={loading}>
          <HitMenuProvider value={hitMenus}>
          {state.view === 'register' ? (
            <SearchRegister
              state={state}
              section={documents}
              onStateChange={onStateChange}
              onLoadMore={() => onLoadMore('document')}
              hideProject={!officeWide}
              activeKey={activeKey}
              listId={registerId}
              optionId={optionId}
            />
          ) : (
            <SearchResultList
              sections={sections}
              onLoadMore={onLoadMore}
              text={state.text}
              activeKey={activeKey}
              listId={listId}
              optionId={optionId}
              scope={surfaceScope(surface, state)}
            />
          )}
          </HitMenuProvider>
        </ResultsBody>
      )}
    </SearchFrame>
  )
}
