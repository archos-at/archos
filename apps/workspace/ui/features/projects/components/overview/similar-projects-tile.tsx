'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { GitCompareArrows } from 'lucide-react'
import { BentoTile, type BentoSpan } from '@/components/ui/bento'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { referencesCopy } from '@/i18n/namespaces/references'
import { settingsCopy } from '@/i18n/namespaces/settings'
import type { SimilarProjectsPage } from '@/lib/references/types'
import { periodYears } from '@/features/references/components/reference-atoms'

const SHOWN = 3
const TRAITS_SHOWN = 3

export function SimilarProjectsTile({
  page,
  href,
  span = 'wide',
}: {
  page: SimilarProjectsPage
  href: string
  span?: BentoSpan
}): JSX.Element {
  const t = useTranslations(settingsCopy)
  const tRefs = useTranslations(referencesCopy)
  const alike = page.projects.filter((project) => project.alike)
  const anyClosed = page.projects.length > 0
  const counted = page.more === 0 || alike.length < page.projects.length

  return (
    <BentoTile
      label={t('project.overview.similar.label')}
      icon={GitCompareArrows}
      span={span}
      href={anyClosed ? href : undefined}
      linkLabel={
        alike.length === 0
          ? t('project.overview.similar.openOthers')
          : counted
            ? t('project.overview.similar.open', { count: alike.length })
            : t('project.overview.similar.openMore')
      }
      data-testid="overview-similar"
    >
      {alike.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {anyClosed ? tRefs('noneAlike') : t('project.overview.similar.empty')}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
          {alike.slice(0, SHOWN).map((project) => (
            <li key={project.id} className="flex min-w-0 flex-col gap-1.5">
              <Link
                href={`/app/projects/${encodeURIComponent(project.id)}`}
                className="hover:text-foreground min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
              >
                {project.name}
              </Link>
              <p className="text-muted-foreground text-xs tabular-nums">
                {periodYears(project.period)}
                {' · '}
                {tRefs('summary', project.counts)}
              </p>
              <ul className="flex flex-wrap gap-1">
                {project.sharedTraits.slice(0, TRAITS_SHOWN).map((trait) => (
                  <li key={trait.value}>
                    <Chip
                      variant={trait.confirmed ? 'secondary' : 'warning'}
                      size="sm"
                      title={trait.confirmed ? undefined : tRefs('fields.unconfirmed')}
                    >
                      {trait.value}
                    </Chip>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </BentoTile>
  )
}
