'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowRight, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { formatPropertyValue } from '@/features/bim/lib/format-value'
import { shortIfcType } from '@/features/bim/lib/model-index'
import type { BimElementDetail } from '@/features/bim/hooks/use-bim-model'
import { useModelQuery } from '../../hooks/use-model-query'
import { useResolvedModel } from '../../hooks/use-resolved-model'
import { CardShell } from './card-shell'
import { NoModel } from './no-model'

const pickElement = (payload: Record<string, unknown>) =>
  payload.element as BimElementDetail | null | undefined

export interface IfcElementCardProps {
  title: string
  globalId: string
  modelFile: string | null
  note: string | null
  projectId: string | null
}

export function IfcElementCard({
  title,
  globalId,
  modelFile,
  note,
  projectId,
}: IfcElementCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const {
    model,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const { data: element, isLoading, error } = useModelQuery(
    model?.id ?? null,
    { op: 'element', globalId },
    pickElement
  )

  return (
    <CardShell
      title={title}
      icon={Boxes}
      action={
        model && projectId ? (
          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildModelHref(projectId, {
                model: model.filename,
                element: globalId,
                storey: element?.storeyName ?? undefined,
                highlights: [{ status: 'info', globalIds: [globalId] }],
              })}
            >
              {t('card.openModel')}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        ) : null
      }
    >
      {!model ? (
        <NoModel isLoading={modelsLoading} error={modelsError} ambiguous={ambiguous} notReady={notReady} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-sm text-destructive">{t('properties.loadFailed')}</p>
      ) : !element ? (
        <EmptyState title={t('element.notFound')} />
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{shortIfcType(element.ifcType)}</span>
            {element.storeyName && (
              <span className="font-mono text-xs text-muted-foreground">{element.storeyName}</span>
            )}
            {element.typeName && <span className="text-muted-foreground">{element.typeName}</span>}
          </div>
          {element.materials.length > 0 && (
            <p className="text-muted-foreground">{element.materials.join(' · ')}</p>
          )}
          {Object.entries(element.properties).map(([setName, properties]) => (
            <div key={setName} className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">{setName}</p>
              <dl className="space-y-0.5">
                {Object.entries(properties).map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="font-medium">{formatPropertyValue(value, locale)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {note && <p className="text-muted-foreground">{note}</p>}
        </div>
      )}
    </CardShell>
  )
}
