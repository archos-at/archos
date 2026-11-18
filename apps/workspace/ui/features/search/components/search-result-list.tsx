'use client'

import type { JSX, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Building2, FileText, Folder, MessageSquare, MessageSquareWarning } from 'lucide-react'

import { LoadMore } from '@/components/ui/load-more'
import { useLocale, useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { ANNOTATION_KINDS, ANNOTATION_STATUSES } from '@/lib/annotations/types'
import { formatRelativeTime } from '@/lib/format'
import { keepUnitsTogether } from '@/lib/text/keep-units'
import { termSegments } from '@/lib/text/term-segments'
import {
  SEARCH_KINDS,
  type AnnotationHit,
  type ConversationHit,
  type DocumentHit,
  type FolderHit,
  type ProjectHit,
  type SearchHit,
  type SearchKind,
  type SearchScopeQuery,
} from '@/lib/search/search-wire'
import { useSearchLabels } from '../hooks/use-search-labels'
import { DocumentHitMenu, useHitMenus } from './hit-actions-menu'
import { annotationHitHref, conversationHitHref, documentHitHref, folderHitHref, projectHitHref } from '../lib/search-hrefs'
import { useSearchReturn } from '../hooks/use-search-return'
import type { SectionView } from '../lib/sections'
import {
  Excerpt,
  MatchedText,
  MatchHint,
  MetaLine,
  MetaPart,
  PassageQuote,
  ResultRow,
  ResultSection,
  ShelfMark,
  SupersededMark,
  WherePart,
  useCompactRow,
} from './search-atoms'

export interface SearchResultListProps {
  sections: Partial<Record<SearchKind, SectionView>>
  onLoadMore: (kind: SearchKind) => void
  text: string
  activeKey: string | null
  listId?: (kind: SearchKind) => string
  optionId?: (hit: SearchHit) => string
  scope?: SearchScopeQuery
}

const HitScopeContext = createContext<SearchScopeQuery>({})

export function HitScopeProvider({ scope, children }: { scope: SearchScopeQuery; children: ReactNode }): JSX.Element {
  return <HitScopeContext.Provider value={scope}>{children}</HitScopeContext.Provider>
}

export function SearchResultList({ sections, onLoadMore, text, activeKey, listId, optionId, scope = {} }: SearchResultListProps): JSX.Element {
  return (
    <HitScopeProvider scope={scope}>
      {SEARCH_KINDS.map((kind) => {
        const section = sections[kind]
        if (!section || section.hits.length === 0) return null
        return (
          <KindSection
            key={kind}
            kind={kind}
            section={section}
            text={text}
            activeKey={activeKey}
            onLoadMore={() => onLoadMore(kind)}
            listId={listId?.(kind)}
            optionId={optionId}
          />
        )
      })}
    </HitScopeProvider>
  )
}

export function HitRow({ hit, text, active = false, id }: { hit: SearchHit; text: string; active?: boolean; id?: string }): JSX.Element {
  switch (hit.kind) {
    case 'document':
      return <DocumentRow hit={hit} text={text} active={active} id={id} />
    case 'annotation':
      return <AnnotationRow hit={hit} active={active} id={id} />
    case 'folder':
      return <FolderRow hit={hit} active={active} id={id} />
    case 'project':
      return <ProjectRow hit={hit} active={active} id={id} />
    case 'conversation':
      return <ConversationRow hit={hit} active={active} id={id} />
  }
}

function KindSection({
  kind,
  section,
  text,
  activeKey,
  onLoadMore,
  listId,
  optionId,
}: {
  kind: SearchKind
  section: SectionView
  text: string
  activeKey: string | null
  onLoadMore: () => void
  listId?: string
  optionId?: (hit: SearchHit) => string
}): JSX.Element {
  const t = useTranslations(searchCopy)
  const total = section.totalIsLowerBound ? t('totalAtLeast', { count: section.total }) : String(section.total)
  const row = (hit: SearchHit): JSX.Element => (
    <HitRow key={hit.id} hit={hit} text={text} active={activeKey === `${hit.kind}:${hit.id}`} id={optionId?.(hit)} />
  )
  return (
    <ResultSection
      title={t(`kinds.${kind}`)}
      count={total}
      listId={listId}
      testId={`search-section-${kind}`}
      footer={
        <LoadMore
          hasMore={section.nextCursor !== null}
          loading={section.loadingMore}
          failed={section.loadMoreFailed}
          onLoadMore={onLoadMore}
          auto={false}
          loadMoreLabel={t('loadMore')}
          loadingLabel={t('loadingMore')}
          failedLabel={t('loadMoreFailed')}
        />
      }
    >
      {section.hits.map(row)}
    </ResultSection>
  )
}

function useWhere(): (shelf: 'project' | 'office_shelf', projectId: string | null, projectName: string | null, folderName?: string | null) => JSX.Element[] {
  const tWhere = useTranslations(searchCopy, 'where')
  const scope = useContext(HitScopeContext)
  const wrap = !useCompactRow()
  return (shelf, projectId, projectName, folderName = null) => {
    const said = shelf === 'office_shelf' ? scope.scope === 'office_shelf' : scope.scope === 'project' && scope.projectId === projectId
    const mark = said ? null : shelf === 'office_shelf' ? (
      <ShelfMark key="shelf" shelf="office_shelf" label={tWhere('officeShelf')} wrap={wrap} quiet={!wrap} />
    ) : projectName ? (
      <ShelfMark key="shelf" shelf="project" label={projectName} wrap={wrap} quiet={!wrap} />
    ) : null
    const folder = folderName ? (
      <WherePart key="folder" label={tWhere('folder')}>
        {folderName}
      </WherePart>
    ) : null
    return [mark, folder].filter((part): part is JSX.Element => part !== null)
  }
}

function DocumentRow({ hit, text, active, id }: { hit: DocumentHit; text: string; active: boolean; id?: string }): JSX.Element {
  const t = useTranslations(searchCopy)
  const labels = useSearchLabels()
  const where = useWhere()
  const menus = useHitMenus()
  const type = labels.documentType(hit.documentType)
  const day = labels.day(hit.planDate ?? hit.documentDate)
  const from = useSearchReturn()
  const title = termSegments(hit.title ?? hit.name, text)
  const shown = hit.passage !== null || title.some((segment) => segment.match)
  const matchedOn = text.trim() && !shown ? hit.matchedOn : []
  const compact = useCompactRow()
  return (
    <ResultRow
      href={documentHitHref(hit, from)}
      icon={FileText}
      title={
        <>
          <MatchedText segments={title} />
          {/* Two Fassungen of one plan share a name; in the palette the index stands beside it, where the eye compares them. */}
          {compact && hit.planIndex ? <span className="ml-1.5 font-normal text-muted-foreground">{t('document.index', { index: hit.planIndex })}</span> : null}
        </>
      }
      active={active}
      id={id}
      testId={`search-hit-document-${hit.id}`}
      meta={
        <MetaLine
          lead={where(hit.shelf, hit.projectId, hit.projectName, hit.folderName)}
          parts={[
            type && !compact ? <MetaPart key="type">{type}</MetaPart> : null,
            hit.planNumber ? <MetaPart key="number" code>{hit.planNumber}</MetaPart> : null,
            hit.planIndex && !compact ? <MetaPart key="index">{t('document.index', { index: hit.planIndex })}</MetaPart> : null,
            hit.scale && !compact ? <MetaPart key="scale" code>{hit.scale}</MetaPart> : null,
            day ? <MetaPart key="day">{day}</MetaPart> : null,
          ]}
        />
      }
      aside={hit.superseded ? <SupersededMark quiet={compact} /> : null}
      actions={menus ? <DocumentHitMenu hit={hit} /> : undefined}
    >
      {/* The palette shows a passage only where the name did not match: there it is why the row is here; under a name that matched it was a third line saying it twice. */}
      {hit.passage && !(compact && title.some((segment) => segment.match)) ? (
        <PassageQuote
          segments={termSegments(hit.passage.text, text)}
          page={hit.passage.page !== null ? t('passage.page', { page: hit.passage.page }) : undefined}
        />
      ) : matchedOn.length > 0 ? (
        <MatchHint label={t('matchedOn.label')} parts={matchedOn.map((reason) => t(`matchedOn.${reason}`))} />
      ) : null}
      {hit.changedFacts.length > 0 && !compact ? (
        <MatchHint
          label={t('document.changed')}
          testId="search-changed-facts"
          parts={hit.changedFacts.map((change) => {
            const fact = labels.factKey(change.key)
            if (change.before === null) return t('document.changedAdded', { fact, after: keepUnitsTogether(change.after ?? '') })
            if (change.after === null) return t('document.changedRemoved', { fact })
            return t('document.changedValue', { fact, before: keepUnitsTogether(change.before), after: keepUnitsTogether(change.after) })
          })}
        />
      ) : null}
    </ResultRow>
  )
}

function AnnotationRow({ hit, active, id }: { hit: AnnotationHit; active: boolean; id?: string }): JSX.Element {
  const t = useTranslations(searchCopy)
  const where = useWhere()
  const kind = (ANNOTATION_KINDS as readonly string[]).includes(hit.annotationKind) ? t(`annotation.kinds.${hit.annotationKind}`) : hit.annotationKind
  const from = useSearchReturn()
  const status = (ANNOTATION_STATUSES as readonly string[]).includes(hit.status) ? t(`annotation.statuses.${hit.status}`) : hit.status
  const on = t('annotation.on', { document: hit.documentName })
  const compact = useCompactRow()
  return (
    <ResultRow
      href={annotationHitHref(hit, from)}
      icon={MessageSquareWarning}
      title={compact && hit.excerpt ? <span className="font-normal text-foreground/85">{hit.excerpt}</span> : on}
      active={active}
      id={id}
      testId={`search-hit-annotation-${hit.id}`}
      meta={
        <MetaLine
          lead={where(hit.shelf, hit.projectId, hit.projectName)}
          parts={[
            compact && hit.excerpt ? <MetaPart key="on">{on}</MetaPart> : null,
            <MetaPart key="kind">{kind}</MetaPart>,
            <MetaPart key="status">{status}</MetaPart>,
          ]}
        />
      }
    >
      {compact && hit.excerpt ? null : <Excerpt>{hit.excerpt}</Excerpt>}
    </ResultRow>
  )
}

function FolderRow({ hit, active, id }: { hit: FolderHit; active: boolean; id?: string }): JSX.Element {
  const compact = useCompactRow()
  const where = useWhere()(hit.shelf, hit.projectId, hit.projectName)
  return (
    <ResultRow
      href={folderHitHref(hit)}
      icon={Folder}
      title={hit.name}
      active={active}
      id={id}
      meta={where.length > 0 ? <MetaLine lead={where} parts={[]} /> : undefined}
      testId={`search-hit-folder-${hit.id}`}
    >
      {/* A folder's description is the page's; in the palette its name and place say which folder. */}
      {hit.excerpt && !compact ? <Excerpt>{hit.excerpt}</Excerpt> : null}
    </ResultRow>
  )
}

function ProjectRow({ hit, active, id }: { hit: ProjectHit; active: boolean; id?: string }): JSX.Element {
  return (
    <ResultRow href={projectHitHref(hit)} icon={Building2} title={hit.name} active={active} id={id} testId={`search-hit-project-${hit.id}`}>
      {hit.excerpt ? <Excerpt>{hit.excerpt}</Excerpt> : null}
    </ResultRow>
  )
}

function ConversationRow({ hit, active, id }: { hit: ConversationHit; active: boolean; id?: string }): JSX.Element {
  const { locale } = useLocale()
  const where = useWhere()
  return (
    <ResultRow
      href={conversationHitHref(hit)}
      icon={MessageSquare}
      title={hit.title}
      active={active}
      id={id}
      meta={
        <MetaLine
          lead={hit.projectName ? where('project', hit.projectId, hit.projectName) : []}
          parts={[<MetaPart key="when">{formatRelativeTime(hit.updatedAt, locale)}</MetaPart>]}
        />
      }
      testId={`search-hit-conversation-${hit.id}`}
    />
  )
}
