'use client'

import { useMemo, type JSX, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { CountPill } from '@/components/ui/count-pill'
import { PageHeader } from '@/components/ui/page-header'
import { SECTION_HEADER_CLASS } from '@/components/shell/project-section-frame'
import { SECTION_CONTENT_WIDTH } from '@/components/shell/section-layout'
import { SectionPlaceScope, SectionPlaceUp, useSectionPlace } from '@/components/shell/section-place'
import { SectionToolRow, SectionToolRowScope } from '@/components/shell/section-tool-row'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { useOfficeShelfDocuments } from '../hooks/use-office-shelf-documents'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { OFFICE_SHELF_ENDPOINTS, type FileShelf } from '../lib/file-shelf'
import { FileWorkspace } from './file-workspace'
import { SearchWorkspace, ShelfSearchBack, useShelfSearchMode } from '@/features/search'

interface OfficeShelfWorkspaceProps {
  canManage: boolean
  showModels?: boolean
  trailingActions?: ReactNode
  organizationName?: string | null
}

export function OfficeShelfWorkspace({
  canManage,
  showModels = false,
  trailingActions,
  organizationName = null,
}: OfficeShelfWorkspaceProps) {
  const t = useTranslations(officeShelfCopy)
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const phone = usePhoneLayout()
  const search = useShelfSearchMode()

  const shelf: FileShelf = {
    source: 'office',
    documentScope: 'officeShelf',
    endpoints: OFFICE_SHELF_ENDPOINTS,
    projectId: null,
    canManage,
    canCollaborate: false,
    useUpload: ({ collectionName, folderId, onComplete }) =>
      useOfficeShelfDocuments({
        collectionName: canManage ? collectionName : undefined,
        folderId,
        onComplete,
      }),
    probeNames: probe.officeShelf,
    probeRevisions: probe.officeShelfRevisions,
    preview: { kind: 'dialog' },
    messages: {
      dropToUpload: t('workspace.dropToUpload'),
      ingestionComplete: (name) => t('toast.ingestionComplete', { name }),
    },
    showModels,
  }

  if (search.active) {
    return (
      <SearchWorkspace
        surface={{ kind: 'office_shelf', folderId: search.folderId }}
        inset
        autoFocus
        leading={
          <>
            <ShelfSearchBack onClose={search.close} label="backToShelf" />
            {trailingActions}
          </>
        }
      />
    )
  }

  return (
    <SectionPlaceScope root={t('title')}>
      <SectionToolRowScope enabled={!phone}>
        <FileWorkspace
          shelf={shelf}
          onOpenSearch={search.open}
          renderHeader={(controls, { count }) => (
            <OfficeShelfHeader controls={controls} count={count} phone={phone} trailingActions={trailingActions} organizationName={organizationName} />
          )}
        />
      </SectionToolRowScope>
    </SectionPlaceScope>
  )
}

function OfficeShelfHeader({
  controls,
  count,
  phone,
  trailingActions,
  organizationName,
}: {
  controls: ReactNode
  count: number | null
  phone: boolean
  trailingActions?: ReactNode
  organizationName: string | null
}): JSX.Element {
  const t = useTranslations(officeShelfCopy)
  const place = useSectionPlace()
  return (
    <div className={cn(SECTION_HEADER_CLASS, SECTION_CONTENT_WIDTH)} data-testid="office-shelf-header">
      <PageHeader
        title={
          place ? (
            place.title
          ) : (
            <span className="inline-flex min-w-0 items-center gap-2">
              {t('title')}
              {count !== null && count > 0 && <CountPill data-testid="office-shelf-document-count" count={count} />}
            </span>
          )
        }
        titleClassName="line-clamp-2"
        titleTooltip={place?.title}
        titleAside={place?.count && <span className="text-muted-foreground text-[13px] leading-5 tabular-nums phone:hidden">{place.count}</span>}
        crumb={
          phone ? (
            place?.phoneTrail
          ) : organizationName ? (
            <>
              <span className="max-w-[16rem] shrink-0 truncate" title={organizationName}>{organizationName}</span>
              {place && <ChevronRight className="size-3 shrink-0" aria-hidden />}
              {place?.trail}
            </>
          ) : (
            place?.trail
          )
        }
        crumbClassName={phone ? 'text-[13px] leading-5' : undefined}
        titleStart={place ? <SectionPlaceUp up={place.up} /> : undefined}
        action={trailingActions}
        actionInline
      />
      <SectionToolRow className="mt-4">
        <div className="flex min-w-0 flex-1" data-testid="office-shelf-controls">
          {controls}
        </div>
      </SectionToolRow>
    </div>
  )
}
