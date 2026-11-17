'use client'

import type { JSX, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react'

import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LoadMore } from '@/components/ui/load-more'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { documentReadFamily } from '@/lib/documents/document-status'
import type { DocumentHit } from '@/lib/search/search-wire'
import { useSearchLabels } from '../hooks/use-search-labels'
import { documentHitHref } from '../lib/search-hrefs'
import { useSearchReturn } from '../hooks/use-search-return'
import {
  COLUMN_SORT,
  columnSortState,
  effectiveSort,
  FIXED_REGISTER_COLUMN,
  REGISTER_COLUMNS,
  sortByColumn,
  toggleRegisterColumn,
  visibleRegisterColumns,
  type RegisterColumn,
} from '../lib/search-sort'
import { compactFilters, type SearchUrlState } from '../lib/search-url'
import { titleSpan } from '../lib/register-cells'
import { headerRem, valuesRem, withoutLegalForm, type CellSetting, type ColumnFit } from '../lib/register-fit'
import type { SectionView } from '../lib/sections'
import { DocumentHitMenu, useHitMenus } from './hit-actions-menu'
import {
  LabelledSwitch,
  MetaPart,
  REGISTER_ACTIONS_WIDTH,
  RegisterActionsCell,
  RegisterActionsHead,
  RegisterBar,
  RegisterBody,
  RegisterCell,
  RegisterHead,
  RegisterHeadCell,
  RegisterLink,
  RegisterRow,
  RegisterStack,
  RegisterStackRow,
  RegisterTable,
  RegisterTitle,
  HitBadge,
  ShelfMark,
  SupersededMark,
} from './search-atoms'

const NUMERIC: ReadonlySet<RegisterColumn> = new Set(['pages'])

const SETTING: Readonly<Record<RegisterColumn, Exclude<CellSetting, 'header'>>> = {
  planNumber: 'code',
  planIndex: 'code',
  title: 'strong',
  planDate: 'text',
  scale: 'code',
  documentType: 'text',
  author: 'text',
  project: 'mark',
  folder: 'text',
  uploaded: 'text',
  pages: 'text',
  status: 'text',
}

const SUPERSEDED_REM = 5.5

function useColumnFits(columns: readonly RegisterColumn[], hits: readonly DocumentHit[]): ColumnFit[] {
  const t = useTranslations(searchCopy)
  const labels = useSearchLabels()
  const text = (column: RegisterColumn, hit: DocumentHit): string | null => {
    switch (column) {
      case 'planNumber':
        return hit.planNumber
      case 'planIndex':
        return hit.planIndex
      case 'title':
        return hit.title ?? hit.name
      case 'planDate':
        return labels.day(hit.planDate)
      case 'scale':
        return hit.scale
      case 'documentType':
        return labels.documentType(hit.documentType)
      case 'author':
        return hit.author ? withoutLegalForm(hit.author) : null
      case 'project':
        return hit.shelf === 'office_shelf' ? t('where.officeShelf') : hit.projectName
      case 'folder':
        return hit.folderName
      case 'uploaded':
        return labels.day(hit.uploadedAt)
      case 'pages':
        return hit.pageCount === null ? null : String(hit.pageCount)
      case 'status':
        return documentReadFamily(hit.status) === 'readable' ? null : labels.readState(documentReadFamily(hit.status))
    }
  }
  const ownColumn = hits.filter((hit) => titleSpan(columns, hit) === 1)
  return columns.map((column) => {
    const min = headerRem(t(`register.columns.${column}`))
    if (column !== 'title') return { min, want: valuesRem(hits.map((hit) => text(column, hit)), SETTING[column]) }
    const want = valuesRem(ownColumn.map((hit) => text(column, hit)), SETTING[column])
    return { min, want: want + (ownColumn.some((hit) => hit.superseded) ? SUPERSEDED_REM : 0), rest: true }
  })
}

export interface SearchRegisterProps {
  state: SearchUrlState
  section: SectionView<DocumentHit> | undefined
  onStateChange: (next: SearchUrlState) => void
  onLoadMore: () => void
  hideProject?: boolean
  activeKey: string | null
  listId?: string
  optionId?: (hit: DocumentHit) => string
}

export function SearchRegisterBar({
  state,
  onStateChange,
  hideProject = false,
}: {
  state: SearchUrlState
  onStateChange: (next: SearchUrlState) => void
  hideProject?: boolean
}): JSX.Element {
  const t = useTranslations(searchCopy)
  const isMobile = useIsMobile()
  return (
    <RegisterBar
      start={
        <LabelledSwitch
          id="search-register-current"
          label={t('register.currentOnly')}
          checked={Boolean(state.filters.currentOnly)}
          onCheckedChange={(on) => onStateChange({ ...state, filters: compactFilters({ ...state.filters, currentOnly: on || undefined }) })}
          testId="search-register-current"
        />
      }
      end={
        <>
          {isMobile ? <SortMenu state={state} onStateChange={onStateChange} hideProject={hideProject} /> : null}
          <ColumnMenu state={state} onStateChange={onStateChange} hideProject={hideProject} />
        </>
      }
    />
  )
}

function ColumnMenu({ state, onStateChange, hideProject }: { state: SearchUrlState; onStateChange: (next: SearchUrlState) => void; hideProject: boolean }): JSX.Element {
  const t = useTranslations(searchCopy)
  const isMobile = useIsMobile()
  const visible = new Set(visibleRegisterColumns(state.columns))
  const offered = REGISTER_COLUMNS.filter((column) => !(hideProject && column === 'project'))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={isMobile ? t('register.fieldsMenuTitle') : t('register.columnsMenuTitle')} data-testid="search-register-columns">
          <Columns3 aria-hidden />
          {isMobile ? t('register.fieldsMenu') : t('register.columnsMenu')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{isMobile ? t('register.fieldsMenuTitle') : t('register.columnsMenuTitle')}</DropdownMenuLabel>
        {offered.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={visible.has(column)}
            disabled={column === FIXED_REGISTER_COLUMN}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onStateChange({ ...state, columns: toggleRegisterColumn(state.columns, column) })}
            data-testid={`search-register-column-${column}`}
          >
            {t(`register.columns.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
        {state.columns !== null ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onStateChange({ ...state, columns: null })} data-testid="search-register-columns-reset">
              {t('register.columnsReset')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortMenu({ state, onStateChange, hideProject }: { state: SearchUrlState; onStateChange: (next: SearchUrlState) => void; hideProject: boolean }): JSX.Element {
  const t = useTranslations(searchCopy)
  const columns = visibleRegisterColumns(state.columns, { hideProject })
  const order = effectiveSort(state)
  const active = columns.find((column) => COLUMN_SORT[column] === order.sort) ?? null
  const Icon = active === null ? ArrowUpDown : order.dir === 'asc' ? ArrowUp : ArrowDown
  const label = active === null ? t('register.sortMenu') : t(`register.columns.${active}`)
  return (
    <ActionMenu
      mode="dropdown"
      entries={[
        { type: 'label', label: t('register.sortMenuTitle') },
        {
          type: 'radio-group',
          value: active ?? '',
          onValueChange: (value) => {
            const column = columns.find((entry) => entry === value)
            if (column) onStateChange(sortByColumn(state, column))
          },
          items: columns.map((column) => ({ value: column, label: t(`register.columns.${column}`), testId: `search-register-sort-${column}` })),
        },
        { type: 'separator' },
        { type: 'label', label: t('register.sortMenuHint') },
      ]}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={active === null ? t('register.sortMenu') : t('register.sortMenuLabel', { column: label, direction: order.dir === 'asc' ? t('register.ascending') : t('register.descending') })}
          data-testid="search-register-sort"
        >
          <Icon aria-hidden />
          {label}
        </Button>
      }
    />
  )
}

export function SearchRegister({ state, section, onStateChange, onLoadMore, hideProject = false, activeKey, listId, optionId }: SearchRegisterProps): JSX.Element {
  const t = useTranslations(searchCopy)
  const isMobile = useIsMobile()
  const columns = visibleRegisterColumns(state.columns, { hideProject })
  const menus = useHitMenus()
  const hits = section?.hits ?? []
  const fits = useColumnFits(columns, hits)
  return (
    <>
      {isMobile ? (
        <RegisterStack id={listId} label={t('register.caption')} testId="search-register">
          {hits.map((hit) => (
            <RegisterStackLine key={hit.id} hit={hit} columns={columns} active={activeKey === `document:${hit.id}`} id={optionId?.(hit)} />
          ))}
        </RegisterStack>
      ) : (
        <RegisterTable
          id={listId}
          caption={t('register.caption')}
          testId="search-register"
          columns={fits}
          actionsRem={menus ? REGISTER_ACTIONS_WIDTH : 0}
          scrollLabel={t('register.scrollLabel')}
        >
          <RegisterHead>
            {columns.map((column) => {
              const label = t(`register.columns.${column}`)
              return (
                <RegisterHeadCell
                  key={column}
                  label={label}
                  numeric={NUMERIC.has(column)}
                  sort={{
                    ariaLabel: t('register.sortBy', { column: label }),
                    direction: columnSortState(state, column),
                    onSort: () => onStateChange(sortByColumn(state, column)),
                  }}
                />
              )
            })}
            {menus ? <RegisterActionsHead label={t('hitActions.column')} /> : null}
          </RegisterHead>
          <RegisterBody>
            {hits.map((hit) => (
              <RegisterLine key={hit.id} hit={hit} columns={columns} active={activeKey === `document:${hit.id}`} id={optionId?.(hit)} />
            ))}
          </RegisterBody>
        </RegisterTable>
      )}
      {section ? (
        <LoadMore
          hasMore={section.nextCursor !== null}
          loading={section.loadingMore}
          failed={section.loadMoreFailed}
          onLoadMore={onLoadMore}
          loadMoreLabel={t('loadMore')}
          loadingLabel={t('loadingMore')}
          failedLabel={t('loadMoreFailed')}
        />
      ) : null}
    </>
  )
}

function useReadException(hit: DocumentHit): string | null {
  const labels = useSearchLabels()
  const family = documentReadFamily(hit.status)
  return family === 'readable' ? null : labels.readState(family)
}

function RegisterLine({ hit, columns, active, id }: { hit: DocumentHit; columns: readonly RegisterColumn[]; active: boolean; id?: string }): JSX.Element {
  const from = useSearchReturn()
  const t = useTranslations(searchCopy)
  const menus = useHitMenus()
  const labels = useSearchLabels()
  const exception = useReadException(hit)
  const span = titleSpan(columns, hit)
  const at = columns.indexOf('title')
  const shown = columns.filter((_, index) => index <= at || index >= at + span)
  const cell = (column: RegisterColumn): JSX.Element => {
    switch (column) {
      case 'planNumber':
        return <RegisterCell key={column} kind="code" title={hit.planNumber ?? undefined}>{hit.planNumber}</RegisterCell>
      case 'planIndex':
        return <RegisterCell key={column} kind="code">{hit.planIndex}</RegisterCell>
      case 'planDate':
        return <RegisterCell key={column} kind="muted">{labels.day(hit.planDate)}</RegisterCell>
      case 'scale':
        return <RegisterCell key={column} kind="code">{hit.scale}</RegisterCell>
      case 'title':
        return (
          <RegisterCell key={column} kind="strong" title={hit.title ?? hit.name} span={span}>
            <RegisterTitle mark={hit.superseded ? <SupersededMark /> : null}>
              <RegisterLink href={documentHitHref(hit, from)}>{hit.title ?? hit.name}</RegisterLink>
            </RegisterTitle>
          </RegisterCell>
        )
      case 'documentType': {
        const type = labels.documentType(hit.documentType)
        return <RegisterCell key={column} title={type ?? undefined}>{type}</RegisterCell>
      }
      case 'author':
        return <RegisterCell key={column} title={hit.author ?? undefined}>{hit.author ? withoutLegalForm(hit.author) : null}</RegisterCell>
      case 'project':
        return (
          <RegisterCell key={column} kind="mark">
            {hit.shelf === 'office_shelf' ? (
              <ShelfMark shelf="office_shelf" label={t('where.officeShelf')} />
            ) : hit.projectName ? (
              <ShelfMark shelf="project" label={hit.projectName} />
            ) : null}
          </RegisterCell>
        )
      case 'folder':
        return <RegisterCell key={column} title={hit.folderPath || undefined}>{hit.folderName}</RegisterCell>
      case 'uploaded':
        return <RegisterCell key={column} kind="muted">{labels.day(hit.uploadedAt)}</RegisterCell>
      case 'pages':
        return <RegisterCell key={column} kind="figure">{hit.pageCount}</RegisterCell>
      case 'status':
        return (
          <RegisterCell key={column} kind="muted">
            {exception}
          </RegisterCell>
        )
    }
  }
  return (
    <RegisterRow active={active} id={id} testId={`search-register-row-${hit.id}`}>
      {shown.map(cell)}
      {menus ? (
        <RegisterActionsCell>
          <DocumentHitMenu hit={hit} />
        </RegisterActionsCell>
      ) : null}
    </RegisterRow>
  )
}

function RegisterStackLine({ hit, columns, active, id }: { hit: DocumentHit; columns: readonly RegisterColumn[]; active: boolean; id?: string }): JSX.Element {
  const from = useSearchReturn()
  const t = useTranslations(searchCopy)
  const labels = useSearchLabels()
  const exception = useReadException(hit)
  const menus = useHitMenus()
  const shown = new Set(columns)
  const code = [shown.has('planNumber') ? hit.planNumber : null, shown.has('planIndex') && hit.planIndex ? `${t('register.columns.planIndex')} ${hit.planIndex}` : null]
    .filter(Boolean)
    .join(' · ')
  const meta = (column: RegisterColumn): ReactNode => {
    switch (column) {
      case 'planDate':
        return hit.planDate ? <MetaPart>{labels.day(hit.planDate)}</MetaPart> : null
      case 'scale':
        return hit.scale ? <MetaPart code>{hit.scale}</MetaPart> : null
      case 'documentType':
        return labels.documentType(hit.documentType)
      case 'author':
        return hit.author ? withoutLegalForm(hit.author) : null
      case 'folder':
        return hit.folderName
      case 'uploaded':
        return <MetaPart>{labels.day(hit.uploadedAt)}</MetaPart>
      case 'pages':
        return hit.pageCount === null ? null : <MetaPart>{`${hit.pageCount} ${t('register.columns.pages')}`}</MetaPart>
      default:
        return null
    }
  }
  return (
    <RegisterStackRow
      id={id}
      href={documentHitHref(hit, from)}
      code={code || undefined}
      title={hit.title ?? hit.name}
      meta={columns.map(meta)}
      where={
        !shown.has('project') ? undefined : hit.shelf === 'office_shelf' ? (
          <ShelfMark shelf="office_shelf" label={t('where.officeShelf')} wrap />
        ) : hit.projectName ? (
          <ShelfMark shelf="project" label={hit.projectName} wrap />
        ) : undefined
      }
      aside={hit.superseded ? <SupersededMark /> : shown.has('status') && exception ? <HitBadge>{exception}</HitBadge> : undefined}
      active={active}
      testId={`search-register-row-${hit.id}`}
      actions={menus ? <DocumentHitMenu hit={hit} /> : undefined}
    />
  )
}
