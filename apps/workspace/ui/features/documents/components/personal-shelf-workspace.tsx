'use client'

import { useMemo, type JSX, type ReactNode } from 'react'
import { SectionPlaceScope, useSectionPlace } from '@/components/shell/section-place'
import { SectionToolRowScope } from '@/components/shell/section-tool-row'
import { ShelfHead } from '@/components/shell/shelf-head'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { useFileUpload } from '../hooks/use-file-upload'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { PERSONAL_SHELF_ENDPOINTS, type FileShelf } from '../lib/file-shelf'
import { FileWorkspace } from './file-workspace'

export interface PersonalShelfWorkspaceProps {
  userId: string
  showModels?: boolean
  trailingActions?: ReactNode
}

export function PersonalShelfWorkspace({ userId, showModels = false, trailingActions }: PersonalShelfWorkspaceProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const phone = usePhoneLayout()

  const shelf: FileShelf = {
    source: 'personal',
    documentScope: 'files',
    endpoints: PERSONAL_SHELF_ENDPOINTS,
    projectId: null,
    canManage: true,
    canCollaborate: false,
    currentUserId: userId,
    useUpload: ({ collectionName, folderId, onComplete }) =>
      useFileUpload({ collectionName, folderId, personalShelf: userId, onComplete }),
    probeNames: probe.personalShelf,
    probeRevisions: probe.personalShelfRevisions,
    preview: { kind: 'dialog' },
    messages: {
      dropToUpload: t('personalShelf.dropToUpload'),
      ingestionComplete: (name) => t('personalShelf.ingestionComplete', { name }),
    },
    showModels,
  }


  return (
    <SectionPlaceScope root={t('personalShelf.title')}>
      <SectionToolRowScope enabled={!phone}>
        <FileWorkspace
          shelf={shelf}
          renderHeader={(controls, { count }) => (
            <PersonalShelfHead controls={controls} count={count} phone={phone} trailingActions={trailingActions} />
          )}
        />
      </SectionToolRowScope>
    </SectionPlaceScope>
  )
}

export function PersonalShelfHead({ controls, count, phone, trailingActions }: { controls: ReactNode; count: number | null; phone: boolean; trailingActions?: ReactNode }): JSX.Element {
  const t = useTranslations(filesCopy)
  const place = useSectionPlace()
  return (
    <ShelfHead
      data-testid="personal-shelf-header"
      crumb={[t('personalShelf.crumb')]}
      title={t('personalShelf.title')}
      count={count}
      place={place}
      phone={phone}
      tools={controls}
      action={trailingActions}
    />
  )
}
