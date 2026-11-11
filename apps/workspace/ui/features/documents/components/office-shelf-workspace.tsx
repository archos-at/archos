'use client'

import { useMemo, type ReactNode } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { PageHeader } from '@/components/ui/page-header'
import { SECTION_HEADER_CLASS } from '@/components/shell/project-section-frame'
import { SectionToolRow, SectionToolRowScope } from '@/components/shell/section-tool-row'
import { useTranslations } from '@/i18n'
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
}

/**
 * The office Archiv: {@link FileWorkspace} over the organization's shelf.
 *
 * It is a project's Dateien with the project taken out, and it looks it: the
 * project section's header (title, subtitle, controls), the same cards and rows.
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
    // Dateien's tool row, in the same scope a project's Dateien has from its frame: the level's „Auswählen“ and
    // „Ordner anlegen“ join it instead of standing in a row of their own over the brief.
    <SectionToolRowScope enabled={!phone}>
      <FileWorkspace
        shelf={shelf}
        onOpenSearch={search.open}
        renderHeader={(controls, { count }) => (
          // The project section's header band and PageHeader, so the Büroablage reads as the same kind of store: the
          // title with its count on one line (the sheet's close at its end, top right on a phone too, where the thumb
          // looks for the way out), the tools in one row under it, a line under the band. The count stays with the
          // title: it is a property of the store, and the one number a reader wants before they filter.
          <div className={SECTION_HEADER_CLASS} data-testid="office-shelf-header">
            <PageHeader
              title={
                <span className="inline-flex min-w-0 items-center gap-2">
                  {t('title')}
                  {count !== null && count > 0 && <CountPill data-testid="office-shelf-document-count" count={count} />}
                </span>
              }
              subtitle={t('subtitle')}
              action={trailingActions}
              actionInline
            />
            <SectionToolRow className="mt-4">
              <div className="flex min-w-0 flex-1" data-testid="office-shelf-controls">
                {controls}
              </div>
            </SectionToolRow>
          </div>
        )}
      />
    </SectionToolRowScope>
  )
}
