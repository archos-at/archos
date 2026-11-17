'use client'

import type { JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import { ProjectReindexCard } from '@/features/projects/components/project-reindex-card'
import { SectionLabel } from '@/components/ui/section-label'

export default function ProjectReindexDevPage(): JSX.Element {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8" data-testid="project-reindex-preview">
      <div>
        <h1 className="text-lg font-semibold">Project settings — knowledge index</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rebuilds every document&rsquo;s chunks in one project. Sits above the danger zone: it destroys nothing a
          user uploaded, only the derived index that answers are grounded on.
        </p>
      </div>

      <ProjectReindexCard projectId="preview-project" />

      <div className="space-y-2">
        <SectionLabel as="p">While it runs</SectionLabel>
        <RaisedCard aria-label="Knowledge index, in flight">
          <RaisedCardBody className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Knowledge index</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Rebuild the indexed content of every document in this project. Nothing you uploaded is deleted — only
                the derived chunks answers are grounded on. Use this after a change to how documents are indexed.
              </p>
            </div>
            <Button variant="secondary" disabled className="shrink-0">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              Re-indexing…
            </Button>
          </RaisedCardBody>
        </RaisedCard>
      </div>
    </main>
  )
}
