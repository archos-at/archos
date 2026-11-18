'use client'

import type { JSX, ReactNode } from 'react'
import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { FileFilterMenu } from '@/features/documents/components/file-filter-menu'
import { NO_FILE_FILTERS } from '@/features/documents/lib/file-filters'
import { DEFAULT_FILE_SORT } from '@/features/documents/lib/file-sort'
import { I18nProvider } from '@/i18n'

const noop = (): void => {}

export default function FilesFilterMenuDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <Suspense fallback={<div />}>
      <FilesFilterMenuPreview />
    </Suspense>
  )
}

function Block({
  id,
  only,
  children,
}: {
  id: string
  only: string | null
  children: ReactNode
}): JSX.Element | null {
  if (only !== null && only !== id) return null
  return <div data-testid={`filter-menu-${id}`}>{children}</div>
}

function FilesFilterMenuPreview(): JSX.Element {
  const only = useSearchParams()?.get('section') ?? null
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="bg-background min-h-dvh p-10" data-testid="files-filter-menu-dev">
        <p className="text-muted-foreground mb-6 font-mono text-xs">
          /dev/files-filter-menu — Filter + Sortierung
        </p>

        <Block id="widen" only={only}>
          <section className="mb-8 space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">
              Geöffnet · „Auch zeigen“ an
            </h2>
            {/* Both widening toggles on: older Fassungen beside their current
              one, and retired documents. Each counts once on the trigger. */}
            <div className="flex h-[620px] justify-end rounded-xl border p-4">
              <FileFilterMenu
                defaultOpen
                canCollaborate
                filters={{ ...NO_FILE_FILTERS, showOlderRevisions: true, includeArchived: true }}
                onFiltersChange={noop}
                sort={DEFAULT_FILE_SORT}
                onSortChange={noop}
              />
            </div>
          </section>
        </Block>

        <Block id="open" only={only}>
          <section className="mb-8 space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">Geöffnet</h2>
            {/* Room for the portalled panel, which renders over the page. */}
            <div className="flex h-[560px] justify-end rounded-xl border p-4">
              <FileFilterMenu
                defaultOpen
                canCollaborate
                filters={{
                  ...NO_FILE_FILTERS,
                  assignment: 'mine',
                  kinds: ['model'],
                  statuses: ['failed'],
                }}
                onFiltersChange={noop}
                sort={{ key: 'name', direction: 'asc' }}
                onSortChange={noop}
              />
            </div>
          </section>
        </Block>
        <Block id="trigger" only={only}>
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-medium">Auslöser</h2>
            <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
              <FileFilterMenu
                canCollaborate
                filters={NO_FILE_FILTERS}
                onFiltersChange={noop}
                sort={DEFAULT_FILE_SORT}
                onSortChange={noop}
              />
              {/* Three constraints, one badge — a dimension counts once however
                many values it holds, so "Dateityp: Grundriss + Schnitt" is one
                thing the reader can lift, not two. */}
              <FileFilterMenu
                canCollaborate
                filters={{
                  ...NO_FILE_FILTERS,
                  assignment: 'unassigned',
                  agentAuthoredOnly: true,
                  kinds: ['floorplan', 'section'],
                }}
                onFiltersChange={noop}
                sort={DEFAULT_FILE_SORT}
                onSortChange={noop}
              />
              {/* Older Fassungen shown: one constraint, one count. */}
              <FileFilterMenu
                canCollaborate
                filters={{ ...NO_FILE_FILTERS, showOlderRevisions: true }}
                onFiltersChange={noop}
                sort={DEFAULT_FILE_SORT}
                onSortChange={noop}
              />
            </div>
          </section>
        </Block>
      </main>
    </I18nProvider>
  )
}
