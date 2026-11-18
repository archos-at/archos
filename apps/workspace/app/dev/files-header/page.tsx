'use client'

import type { JSX } from 'react'
import { use, useState } from 'react'
import { notFound } from 'next/navigation'
import { usePhoneLayout } from '@/features/documents/hooks/use-phone-layout'
import type { FileView } from '@/features/documents/hooks/use-view-preference'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { NO_FILE_FILTERS, type FileFilters } from '@/features/documents/lib/file-filters'
import { DEFAULT_FILE_SORT, type FileSort } from '@/features/documents/lib/file-sort'
import { FilesHeaderControls } from '@/features/documents/components/files-header-controls'
import { ProjectUppyUpload } from '@/features/documents/components/project-uppy-upload'
import { I18nProvider } from '@/i18n'
import { ProjectSectionActions, ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { primeInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'

function Header() {
  const phone = usePhoneLayout()
  const [view, setView] = useState<FileView>('cards')
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS)
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT)
  const [query, setQuery] = useState('')

  primeInboundMailWaiting('dev', { count: 3, more: false })
  return (
    <ProjectSectionFrame projectId="dev" projectName="Dev" pathname="/app/projects/dev/files" inboundMail>
      <ProjectSectionActions>
        <FilesHeaderControls
          phone={phone}
          view={view}
          onViewChange={setView}
          renderFilter={(compact) => (
            <FileFilterMenu
              canCollaborate
              filters={filters}
              onFiltersChange={setFilters}
              sort={sort}
              onSortChange={setSort}
              compact={compact}
            />
          )}
          search={{ value: query, onChange: setQuery, onSubmit: () => {}, onClear: () => setQuery('') }}
          upload={phone ? undefined : <ProjectUppyUpload onUpload={() => {}} isUploading={false} allowFolders onSendByMail={() => {}} />}
        />
      </ProjectSectionActions>
    </ProjectSectionFrame>
  )
}

export default function FilesHeaderDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const narrow = use(searchParams).variant === 'narrow'

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="bg-background min-h-dvh py-10">
        <div className={narrow ? 'mx-auto max-w-[900px]' : 'mx-auto max-w-[1400px]'}>
          <p className="text-muted-foreground mb-4 px-4 font-mono text-xs md:px-8">
            /dev/files-header{narrow ? '?variant=narrow' : ''} — Dateien header + action row
          </p>
          <div className="border-border bg-background border-y px-4 py-4 md:px-8">
            <Header />
          </div>
        </div>
      </main>
    </I18nProvider>
  )
}
