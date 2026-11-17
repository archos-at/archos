'use client'

import type { FC, KeyboardEvent } from 'react'
import { AlertTriangle, Archive, ArrowLeft, SearchX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { Spinner } from '@/components/ui/spinner'
import { ProjectInitialsTile } from '@/components/projects/project-atoms'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import type {
  SimilarDocument,
  SimilarGroup,
  SimilarPassagesRequest,
  SimilarPassagesResponse,
} from '@/lib/similar-passages/types'
import { similarDocumentsOf } from '@/lib/similar-passages/types'
import {
  loadSimilarPassages,
  useSimilarPassages,
  type OpenedPassage,
  type SimilarPassagesLoader,
} from '../lib/use-similar-passages'
import {
  SimilarGroupHeading,
  SimilarGroupNote,
  SimilarList,
  SimilarPassageButton,
  SimilarRail,
} from './similar-passage-atoms'

export interface SimilarPassagesPanelProps {
  request: SimilarPassagesRequest
  opened: OpenedPassage | null
  onOpen: (passage: OpenedPassage) => void
  onBackToSource: () => void
  onClose: () => void
  load?: SimilarPassagesLoader
}

const nameOf = (document: SimilarDocument): string => document.displayName ?? document.filename

const passageKey = (document: SimilarDocument, index: number): string => `${document.documentId}#${index}`

const walkPassages = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-similar-passage]'))
  const index = buttons.findIndex((button) => button === document.activeElement)
  if (index === -1) return
  event.preventDefault()
  buttons[Math.min(buttons.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
}

const PLACE_ORDER: Record<SimilarGroup['kind'], number> = { current: 0, project: 1, office_shelf: 2 }
const inPlaceOrder = (groups: SimilarGroup[]): SimilarGroup[] =>
  [...groups].sort((a, b) => PLACE_ORDER[a.kind] - PLACE_ORDER[b.kind])

const TILE = 'size-8 text-[11px]'

const GroupHead: FC<{ group: SimilarGroup }> = ({ group }) => {
  const t = useTranslations(knowledgeCopy)
  if (group.kind === 'office_shelf' || !group.project) {
    return (
      <SimilarGroupHeading
        tile={
          <span aria-hidden className={`grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ${TILE}`}>
            <Archive className="size-4" />
          </span>
        }
        name={t('similar.groupOfficeShelf')}
      />
    )
  }
  return (
    <SimilarGroupHeading
      tile={<ProjectInitialsTile project={group.project} className={TILE} />}
      name={group.project.name}
      meta={
        group.kind === 'current' ? (
          <SimilarGroupNote>{t('similar.groupCurrent')}</SimilarGroupNote>
        ) : group.project.status === 'closed' ? (
          <SimilarGroupNote>{t('similar.groupClosed')}</SimilarGroupNote>
        ) : undefined
      }
    />
  )
}

const headlineOf = (groups: SimilarGroup[], t: ReturnType<typeof useTranslations>): string => {
  const projects = groups.filter((group) => group.kind !== 'office_shelf').length
  const officeShelf = groups.some((group) => group.kind === 'office_shelf')
  if (projects === 0) return t('similar.foundOnlyOfficeShelf')
  return officeShelf ? t('similar.foundWithOfficeShelf', { count: projects }) : t('similar.found', { count: projects })
}

const Results: FC<{
  response: SimilarPassagesResponse
  opened: OpenedPassage | null
  onOpen: (passage: OpenedPassage) => void
}> = ({ response, opened, onOpen }) => {
  const t = useTranslations(knowledgeCopy)
  const documents = similarDocumentsOf(response)
  const groupLabelOf = (group: SimilarGroup): string => {
    if (group.kind === 'office_shelf') return t('similar.groupOfficeShelf')
    if (group.kind === 'current') return t('similar.groupCurrent')
    return group.project?.name ?? ''
  }
  if (documents.length === 0) {
    return (
      <EmptyState
        variant="bare"
        size="sm"
        icon={SearchX}
        title={t('similar.emptyTitle')}
        description={t('similar.emptyBody', { count: response.projectsSearched })}
        data-testid="similar-passages-empty"
      />
    )
  }
  const groups = inPlaceOrder(response.groups.filter((group) => group.documents.length > 0))
  return (
    <SimilarList>
      {groups.map((group) => (
        <section key={group.project?.id ?? 'office_shelf'} className="flex flex-col gap-2" data-similar-group={group.kind}>
          <GroupHead group={group} />
          <div className="flex flex-col gap-1.5">
            {group.documents.flatMap((document) => {
              const rank = documents.indexOf(document)
              const revision = document.stand
                ? document.stand.kind === 'index'
                  ? document.stand.text
                  : t('similar.datedOn', { date: document.stand.text })
                : null
              return document.passages.map((passage, index) => {
                const key = passageKey(document, index)
                const where = [nameOf(document), revision].filter(Boolean)
                return (
                  <SimilarPassageButton
                    key={key}
                    current={opened?.key === key}
                    quote={passage.snippet}
                    source={<span title={where.join(' · ')}>{where.join(' · ')}</span>}
                    page={passage.page === null ? null : t('similar.page', { page: passage.page })}
                    openLabel={t('similar.open')}
                    aria-label={
                      passage.page === null
                        ? t('similar.openPassageNoPage', { document: nameOf(document) })
                        : t('similar.openPassage', { document: nameOf(document), page: passage.page })
                    }
                    onClick={() =>
                      onOpen({
                        key,
                        documentId: document.documentId,
                        filename: document.filename,
                        title: nameOf(document),
                        contentType: document.contentType,
                        page: passage.page,
                        snippet: passage.snippet,
                        groupKind: group.kind,
                        groupLabel: groupLabelOf(group),
                        rank,
                      })
                    }
                  />
                )
              })
            })}
          </div>
        </section>
      ))}
    </SimilarList>
  )
}

export const SimilarPassagesPanel: FC<SimilarPassagesPanelProps> = ({
  request,
  opened,
  onOpen,
  onBackToSource,
  onClose,
  load = loadSimilarPassages,
}) => {
  const t = useTranslations(knowledgeCopy)
  const { state, retry } = useSimilarPassages(request, load)

  return (
    <SimilarRail label={t('similar.title')}>
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <SectionLabel as="h2">{t('similar.title')}</SectionLabel>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-11"
            onClick={onClose}
            aria-label={t('similar.close')}
          >
            <X aria-hidden />
          </Button>
        </div>
        {state.status === 'ready' && similarDocumentsOf(state.response).length > 0 && (
          <p className="text-sm font-medium text-foreground" data-testid="similar-headline">
            {headlineOf(state.response.groups, t)}
          </p>
        )}
        {opened && (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 self-start" onClick={onBackToSource}>
            <ArrowLeft aria-hidden />
            {t('similar.backToSource')}
          </Button>
        )}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={walkPassages}
        aria-busy={state.status === 'loading' || undefined}
      >
        {state.status === 'loading' && (
          <p className="inline-flex items-center gap-2 py-2 text-xs text-muted-foreground" role="status">
            <Spinner size="sm" />
            {t('similar.loading')}
          </p>
        )}
        {state.status === 'error' && (
          <EmptyState
            variant="bare"
            size="sm"
            tone="warning"
            icon={AlertTriangle}
            title={state.failure === 'held' ? t('similar.heldTitle') : t('similar.failedTitle')}
            description={state.failure === 'held' ? t('similar.heldBody') : t('similar.failedBody')}
            data-testid="similar-passages-error"
            action={
              state.failure === 'held' ? undefined : (
                <Button type="button" variant="secondary" size="sm" onClick={retry}>
                  {t('similar.retry')}
                </Button>
              )
            }
          />
        )}
        {state.status === 'ready' && <Results response={state.response} opened={opened} onOpen={onOpen} />}
      </div>
    </SimilarRail>
  )
}
