'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, Boxes } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { documentDisplayName } from '@/lib/documents/display-name'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { useProjectBimModels } from '@/features/bim/hooks/use-bim-model'

export interface IfcModelPickerCardProps {
  title: string
  note: string | null
  projectId: string | null
}

export function IfcModelPickerCard({
  title,
  note,
  projectId,
}: IfcModelPickerCardProps): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { data: models, isLoading, error } = useProjectBimModels(projectId)

  const ready = useMemo(
    () => (models ?? []).filter((candidate) => candidate.status === 'ready'),
    [models]
  )

  if (models === null && isLoading) {
    return (
      <section className="rounded-surface border bg-card p-5" aria-label={title}>
        <PickerHeader title={title} />
        <div className="flex items-center justify-center rounded-control border border-dashed p-6">
          <Spinner size="sm" />
        </div>
      </section>
    )
  }

  if (error !== null) {
    return (
      <section className="rounded-surface border bg-card p-5" aria-label={title}>
        <PickerHeader title={title} />
        <EmptyState title={t('modelPicker.failed')} />
      </section>
    )
  }

  if (!projectId || ready.length === 0) return null

  return (
    <section className="rounded-surface border bg-card p-5" aria-label={title}>
      <PickerHeader title={title} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {ready.map((model) => {
          const label = documentDisplayName(model)
          return (
            <li key={model.id}>
              <Link
                href={buildModelHref(projectId, { model: model.filename })}
                aria-label={t('modelPicker.openAria', { name: label })}
                className="group flex items-center gap-3 rounded-control border bg-background p-3 transition-colors hover:border-primary/60 hover:bg-desk"
              >
                <Boxes className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label}</span>
                  {model.schemaVersion && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {model.schemaVersion}
                    </span>
                  )}
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-colors duration-quick ease-out group-hover:text-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          )
        })}
      </ul>
      {note && <p className="mt-3 text-sm text-muted-foreground">{note}</p>}
    </section>
  )
}

function PickerHeader({ title }: { title: string }): JSX.Element {
  return (
    <header className="mb-3 flex items-center gap-2">
      <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-medium">{title}</h3>
    </header>
  )
}
