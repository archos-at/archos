'use client'

import { useMemo, type JSX, type ReactNode } from 'react'
import { SectionPlaceScope, useSectionPlace } from '@/components/shell/section-place'
import { SectionToolRowScope } from '@/components/shell/section-tool-row'
import { ShelfHead } from '@/components/shell/shelf-head'
import { useTranslations } from '@/i18n'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { useOfficeShelfDocuments, type StoredUpload } from '../hooks/use-office-shelf-documents'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { OFFICE_SHELF_ENDPOINTS, type FileShelf } from '../lib/file-shelf'
import { FileWorkspace } from './file-workspace'
import { FolderBinDialog } from './folder-bin-dialog'
import { binHrefOf } from '../lib/bin-href'
import { useBinParam } from '../hooks/use-bin-param'
import { OfficeShelfFolderNorms } from './office-shelf-folder-norms'

const OFFICE_SHELF_HREF = '/app/office-shelf'
const OFFICE_SHELF_BIN = { kind: 'office_shelf' } as const

export interface OfficeShelfWorkspaceProps {
  canManage: boolean
  showModels?: boolean
  trailingActions?: ReactNode
  organizationName?: string | null
  places?: ReactNode
  onUploadsStored?: (uploads: StoredUpload[]) => void
  onNormsRecorded?: (documentIds: string[]) => void
  fileActions?: FileShelf['fileActions']
  normsInFolders?: boolean
}

export function OfficeShelfWorkspace({
  canManage,
  showModels = false,
  trailingActions,
  organizationName = null,
  places,
  onUploadsStored,
  onNormsRecorded,
  fileActions,
  normsInFolders = false,
}: OfficeShelfWorkspaceProps) {
  const t = useTranslations(officeShelfCopy)
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const phone = usePhoneLayout()
  const bin = useBinParam()

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
        onStored: onUploadsStored,
      }),
    probeNames: probe.officeShelf,
    probeRevisions: probe.officeShelfRevisions,
    preview: { kind: 'dialog' },
    messages: {
      dropToUpload: t('workspace.dropToUpload'),
      ingestionComplete: (name) => t('toast.ingestionComplete', { name }),
    },
    showModels,
    fileActions,
    bin: { href: binHrefOf(OFFICE_SHELF_HREF) },
  }


  return (
    <SectionPlaceScope root={t('title')}>
      <SectionToolRowScope enabled={!phone}>
        <FileWorkspace
          shelf={shelf}
          renderLevelNotice={
            normsInFolders && canManage
              ? ({ folderId, reload }) =>
                  folderId === null ? null : (
                    <OfficeShelfFolderNorms key={folderId} folderId={folderId} onChanged={reload} onRecorded={onNormsRecorded} />
                  )
              : undefined
          }
          renderHeader={(controls, { count }) => (
            <OfficeShelfHeader controls={controls} count={count} phone={phone} trailingActions={trailingActions} organizationName={organizationName} places={places} />
          )}
        />
      </SectionToolRowScope>
      <FolderBinDialog shelf={OFFICE_SHELF_BIN} open={bin.open} onOpenChange={bin.setOpen} />
    </SectionPlaceScope>
  )
}

export function OfficeShelfHeader({
  controls,
  count,
  phone,
  trailingActions,
  organizationName,
  places,
}: {
  controls: ReactNode
  count: number | null
  phone: boolean
  trailingActions?: ReactNode
  organizationName: string | null
  places?: ReactNode
}): JSX.Element {
  const t = useTranslations(officeShelfCopy)
  const place = useSectionPlace()
  return (
    <ShelfHead
      data-testid="office-shelf-header"
      crumb={organizationName ? [organizationName] : []}
      title={t('title')}
      count={count}
      place={place}
      phone={phone}
      tools={controls}
      places={places}
      action={trailingActions}
    />
  )
}
