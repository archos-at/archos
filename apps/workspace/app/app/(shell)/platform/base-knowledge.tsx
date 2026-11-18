'use client'

import { useCallback, useMemo, useState, type JSX } from 'react'
import { BookOpenCheck, FileText, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { CorpusJobDialogs } from '@/features/platform/components/base-knowledge/corpus-job-dialogs'
import { KnowledgeFileTable } from '@/features/platform/components/base-knowledge/file-table'
import { KnowledgeFileToolbar } from '@/features/platform/components/base-knowledge/file-toolbar'
import { useCorpusPlacement } from '@/features/platform/components/corpus-placement'
import { KnowledgeDocumentSheet } from '@/features/platform/components/knowledge-document-sheet'
import { useIngestWatch } from '@/features/platform/components/knowledge-ingest-watch'
import { KnowledgeSummary } from '@/features/platform/components/knowledge-summary'
import { SectionCard } from '@/features/platform/components/section-card'
import { useKnowledgeBaseStatus } from '@/features/platform/hooks/use-knowledge-base-status'
import { useKnowledgeCorpusJobs } from '@/features/platform/hooks/use-knowledge-corpus-jobs'
import { useKnowledgeFileEdits } from '@/features/platform/hooks/use-knowledge-file-edits'
import {
  ALL,
  REINGESTABLE_STATES,
  filterAndSortKnowledgeFiles,
  type SortDir,
  type SortKey,
  type StateFilter,
  type TypeFilter,
} from '@/features/platform/lib/knowledge-file-filter'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PdfViewerDialog } from '@/features/knowledge/components/pdf-viewer-dialog'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { DOC_CLASSES, resolveDocClass, type DocClass } from '@/lib/knowledge/doc-class'

export function BaseKnowledge(): JSX.Element {
  const t = useTranslations(platformCopy)
  const canManage = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeWrite) // the corpus routes' permission
  const placement = useCorpusPlacement() // which country, edition and change request each file belongs to

  const {
    status,
    hasError,
    setHasError,
    isRefreshing,
    fetchStatus,
    applyStatus,
    load,
    files,
    setDocClassOverrides,
    setDisplayTitleOverrides,
  } = useKnowledgeBaseStatus()
  const ingest = useIngestWatch(fetchStatus, applyStatus, files)

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(ALL)
  const [stateFilter, setStateFilter] = useState<StateFilter>(ALL)
  const [sortKey, setSortKey] = useState<SortKey>('class')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])

  const {
    isSyncing,
    syncConfirmOpen,
    setSyncConfirmOpen,
    isReingesting,
    pendingReingest,
    setPendingReingest,
    handleSync,
    handleReingest,
  } = useKnowledgeCorpusJobs({ load, ingest, setSelected })
  const { handleReclassify, handleBulkReclassify, handleRename } = useKnowledgeFileEdits({
    load,
    selected,
    setSelected,
    setDocClassOverrides,
    setDisplayTitleOverrides,
  })

  const [detailName, setDetailName] = useState<string | null>(null)
  const [viewerFile, setViewerFile] = useState<string | null>(null)

  const byName = useMemo(() => new Map(files.map((f) => [f.fileName, f])), [files])
  const detailFile = detailName ? (byName.get(detailName) ?? null) : null

  const presentClasses = useMemo(() => {
    const counts = new Map<DocClass, number>()
    for (const f of files) {
      const cls = resolveDocClass(f.docClass)
      counts.set(cls, (counts.get(cls) ?? 0) + 1)
    }
    return DOC_CLASSES.filter((cls) => counts.has(cls)).map((cls) => ({
      cls,
      count: counts.get(cls) ?? 0,
    }))
  }, [files])

  const reingestable = useMemo(
    () => files.filter((f) => REINGESTABLE_STATES.has(f.state)).map((f) => f.fileName),
    [files]
  )

  const filtered = useMemo(
    () =>
      filterAndSortKnowledgeFiles(
        files,
        { query, typeFilter, stateFilter, sortKey, sortDir },
        placement
      ),
    [files, query, typeFilter, stateFilter, sortKey, sortDir, placement]
  )

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('asc')
      }
      setOffset(0)
    },
    [sortKey]
  )

  const clearFilters = () => {
    setQuery('')
    setTypeFilter(ALL)
    setStateFilter(ALL)
    setOffset(0)
  }

  const hasDocuments = files.length > 0
  const showEmpty =
    !hasDocuments &&
    ingest.items.length === 0 &&
    !ingest.timedOut &&
    ingest.missing.length === 0

  return (
    <div className="flex flex-col gap-6">
      <KnowledgeSummary status={status} files={files} loading={!status && !hasError} />

      {canManage ? null : (
        <p
          className="text-muted-foreground flex items-center gap-1.5 text-sm"
          data-testid="knowledge-read-only"
        >
          <Lock className="size-3.5 shrink-0" aria-hidden />
          {t('knowledgeAdmin.readOnly')}
        </p>
      )}

      <SectionCard
        testId="platform-base-knowledge"
        loading={!status && !hasError}
        refreshing={isRefreshing && status !== null}
        skeletonRows={6}
        error={hasError}
        errorMessage={t('knowledge.loadError')}
        onRetry={() => {
          setHasError(false)
          void load()
        }}
        empty={showEmpty}
        emptyIcon={BookOpenCheck}
        emptyTitle={t('knowledgeAdmin.emptyTitle')}
        emptyDescription={t('knowledgeAdmin.emptyDescription')}
      >
        <div className="flex flex-col gap-4">
          {hasDocuments ? (
            <KnowledgeFileToolbar
              canManage={canManage}
              query={query}
              setQuery={setQuery}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              stateFilter={stateFilter}
              setStateFilter={setStateFilter}
              setOffset={setOffset}
              selected={selected}
              setSelected={setSelected}
              presentClasses={presentClasses}
              isSyncing={isSyncing}
              isReingesting={isReingesting}
              reingestable={reingestable}
              setPendingReingest={setPendingReingest}
              setSyncConfirmOpen={setSyncConfirmOpen}
              onBulkReclassify={handleBulkReclassify}
            />
          ) : null}

          {!hasDocuments ? null : filtered.length === 0 ? (
            <EmptyState
              variant="bare"
              icon={FileText}
              title={t('knowledge.noMatch')}
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {t('knowledge.clearFilters')}
                </Button>
              }
            />
          ) : (
            <KnowledgeFileTable
              canManage={canManage}
              filtered={filtered}
              offset={offset}
              selected={selected}
              setSelected={setSelected}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onOpenDetail={setDetailName}
              onOffsetChange={setOffset}
              placement={placement}
            />
          )}
        </div>
      </SectionCard>

      <KnowledgeDocumentSheet
        file={detailFile}
        onClose={() => setDetailName(null)}
        canManage={canManage}
        onRename={handleRename}
        onReclassify={handleReclassify}
        onView={(file) => {
          setDetailName(null)
          setViewerFile(file.fileName)
        }}
      />

      {viewerFile ? (
        <PdfViewerDialog
          open onOpenChange={(open) => !open && setViewerFile(null)}
          fileName={viewerFile}
          src={`/api/platform/knowledge/documents/${encodeURIComponent(viewerFile)}`}
        />
      ) : null}

      <CorpusJobDialogs
        pendingReingest={pendingReingest}
        setPendingReingest={setPendingReingest}
        onReingest={handleReingest}
        syncConfirmOpen={syncConfirmOpen}
        setSyncConfirmOpen={setSyncConfirmOpen}
        onSync={handleSync}
      />
    </div>
  )
}
