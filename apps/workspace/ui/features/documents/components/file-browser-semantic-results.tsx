'use client'

import { Fragment, type ReactNode } from 'react'
import { SearchX, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileItem } from '../file-types'
import type { FileSearch } from '../hooks/use-file-search'
import { CONTENT_MAX } from './file-browser-skeleton'
import type { FileCardRenderer } from './file-browser-tile'
import { FileGrid, FileCardSkeleton } from './file-grid'
import { FileListSkeleton, FileListView } from './file-list-view'

interface SemanticSearchResultsProps {
  search: FileSearch
  view: 'cards' | 'list'
  selectedFileId: string | null
  onSelectFile: (id: string | null) => void
  renderActions?: (file: FileItem) => ReactNode
  wrapFileRow?: (file: FileItem, row: ReactNode) => ReactNode
  fileCard: FileCardRenderer
}

export function SemanticSearchResults({
  search,
  view,
  selectedFileId,
  onSelectFile,
  renderActions,
  wrapFileRow,
  fileCard,
}: SemanticSearchResultsProps): ReactNode {
  const t = useTranslations(filesCopy)
  const { semantic } = search
  return (
    semantic.isSearching ? (
      view === 'list' ? (
        <div className={CONTENT_MAX}>
          <FileListSkeleton />
        </div>
      ) : (
        <div className={`${CONTENT_MAX} p-4`}>
          <FileGrid>
            {Array.from({ length: 6 }).map((_, i) => (
              <FileCardSkeleton key={i} />
            ))}
          </FileGrid>
        </div>
      )
    ) : semantic.error ? (
      <div className="p-8">
        <EmptyState
          variant="bare"
          icon={SearchX}
          title={t('browser.semantic.failed')}
          description={t('browser.semantic.failedDescription')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* Retries the SAME query — offering only "show all files"
                  asks the reader to give up and retype a search they have
                  already made. */}
              <Button size="sm" onClick={search.run}>
                {t('browser.semantic.retry')}
              </Button>
              <Button variant="secondary" size="sm" onClick={search.clear}>
                {t('browser.semantic.reset')}
              </Button>
            </div>
          }
        />
      </div>
    ) : semantic.hits.length === 0 ? (
      <div className="p-8">
        <EmptyState
          variant="bare"
          icon={Sparkles}
          title={t('browser.semantic.noResults', { query: semantic.query ?? '' })}
          description={t('browser.semantic.noResultsDescription')}
          action={
            <Button variant="secondary" size="sm" onClick={search.clear}>
              {t('browser.semantic.reset')}
            </Button>
          }
        />
      </div>
    ) : view === 'list' ? (
      <div className={CONTENT_MAX}>
        <FileListView
          key={semantic.query ?? ''}
          semantic
          query={semantic.query}
          files={semantic.hits}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          renderActions={renderActions}
          wrapRow={wrapFileRow}
        />
      </div>
    ) : (
      <div className={`${CONTENT_MAX} p-4`}>
        <FileGrid>
          {semantic.hits.map((hit) => (
            <Fragment key={hit.id}>
              {fileCard(hit, { match: { snippet: hit.snippet, page: hit.page, query: semantic.query } })}
            </Fragment>
          ))}
        </FileGrid>
      </div>
    )
  )
}
