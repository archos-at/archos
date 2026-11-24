'use client'

import { useMemo, type JSX, type ReactNode } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { PageHeader } from '@/components/ui/page-header'
import { SECTION_HEADER_CLASS } from '@/components/shell/project-section-frame'
import { SECTION_CONTENT_WIDTH } from '@/components/shell/section-layout'
import { SectionPlaceScope, SectionPlaceUp, useSectionPlace } from '@/components/shell/section-place'
import { SectionToolRow, SectionToolRowScope } from '@/components/shell/section-tool-row'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { cn } from '@/lib/utils'
import { SearchWorkspace, ShelfSearchBack, useShelfSearchMode } from '@/features/search'
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
  const search = useShelfSearchMode()

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

  if (search.active) {
    return (
      <SearchWorkspace
        surface={{ kind: 'personal', folderId: search.folderId }}
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
    <SectionPlaceScope root={t('personalShelf.title')}>
      <SectionToolRowScope enabled={!phone}>
        <FileWorkspace
          shelf={shelf}
          renderHeader={(controls, { count }) => (
            <PersonalShelfHeader controls={controls} count={count} phone={phone} trailingActions={trailingActions} />
          )}
        />
      </SectionToolRowScope>
    </SectionPlaceScope>
  )
}

function PersonalShelfHeader({
  controls,
  count,
  phone,
  trailingActions,
}: {
  controls: ReactNode
  count: number | null
  phone: boolean
  trailingActions?: ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const place = useSectionPlace()
  return (
    <div className={cn(SECTION_HEADER_CLASS, SECTION_CONTENT_WIDTH)} data-testid="personal-shelf-header">
      <PageHeader
        title={
          place ? (
            place.title
          ) : (
            <span className="inline-flex min-w-0 items-center gap-2">
              {t('personalShelf.title')}
              {count !== null && count > 0 && <CountPill data-testid="personal-shelf-document-count" count={count} />}
            </span>
          )
        }
        titleClassName="line-clamp-2"
        titleTooltip={place?.title}
        crumb={place ? (phone ? place.phoneTrail : place.trail) : t('personalShelf.crumb')}
        crumbClassName={phone ? 'text-[13px] leading-5' : undefined}
        titleStart={place ? <SectionPlaceUp up={place.up} /> : undefined}
        action={trailingActions}
        actionInline
      />
      <SectionToolRow className="mt-4">
        <div className="flex min-w-0 flex-1" data-testid="personal-shelf-controls">
          {controls}
        </div>
      </SectionToolRow>
    </div>
  )
}
