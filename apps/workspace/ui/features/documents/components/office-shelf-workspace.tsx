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
  /** Whether the viewer may change the Archiv (holds `org:office_shelf:manage`). */
  canManage: boolean
  /** Whether an `.ifc` here can reach the model workspace (`ifc-models`). */
  showModels?: boolean
  /**
   * Controls beside the header, after the upload button. The Archiv sheet slots
   * its close control here so the workspace's own header stays the sheet's ONE
   * header instead of gaining a twin above it.
   */
  trailingActions?: ReactNode
  /** The office's name, the crumb over the title as a project's name is over its Dateien. */
  organizationName?: string | null
}

/**
 * The office Archiv: {@link FileWorkspace} over the organization's shelf.
 *
 * It is a project's Dateien with the project taken out, and it looks it: the
 * project section's header (crumb, title, tool row, the open folder as its
 * title), the same cards and rows.
 * What it adds is the count beside the title, the sheet's close control, and the
 * permission model: a member without `org:office_shelf:manage` gets
 * the read-only view (list, folders, search, filters, preview, download).
 * There is no assignment (collaboration is project-scoped) and no „Frage zur
 * Datei" (there is no project chat to ask in).
 */
export function OfficeShelfWorkspace({
  canManage,
  showModels = false,
  trailingActions,
  organizationName = null,
}: OfficeShelfWorkspaceProps) {
  const t = useTranslations(officeShelfCopy)
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const phone = usePhoneLayout()
  // „Suche“ in place of the listing (`?mode=search`), scoped to the shelf and the open folder.
  const search = useShelfSearchMode()

  const shelf: FileShelf = {
    source: 'office',
    documentScope: 'officeShelf',
    endpoints: OFFICE_SHELF_ENDPOINTS,
    projectId: null,
    canManage,
    canCollaborate: false,
    // Only managers drive the upload engine; no collection for a read-only
    // viewer keeps its orchestrator effects inert (no background calls that
    // would 403 for them anyway).
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
    // Dateien's header, the same three parts in the same order: where you are (the crumb, inside a folder), what it is
    // (the title, the folder's name inside one, with the way up at its start), what you can do (the tool row). The
    // Büroablage had its own: a standing subtitle, a path row with „Zurück zu …“ under the tools, and no title for
    // the folder (review of 2026-11-11, „passt noch nicht mit der Seite Dateien zusammen“).
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

/**
 * The Büroablage's header: the open folder (from {@link useSectionPlace}) or the store with its count, the sheet's
 * close at the end of the title's line (top right on a phone too, where the thumb looks for the way out), and the tool
 * row under it. The count stays with the store's title: the one number a reader wants before they filter.
 */
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
        // As a project's Dateien: the office over the store („Atelier Nord“), the way there inside a folder („Atelier
        // Nord › Büroablage › Planung“), so the title keeps its line from the top level into a folder. A phone has
        // only the folder's short trail.
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
