'use client'

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/section-label'
import { useLocale, useTranslations } from '@/i18n'
import { referencesCopy } from '@/i18n/namespaces/references'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  ReferenceDecision,
  ReferenceFact,
  ReferenceOrigin,
  ReferencePeriod,
  ReferencePermit,
} from '@/lib/references/types'

export function ReferenceProjectLink({ project }: { project: { id: string; name: string } }): JSX.Element {
  return (
    <Link
      href={`/app/projects/${project.id}`}
      className={cn(
        'after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60',
      )}
    >
      {project.name}
    </Link>
  )
}

export function ReferenceRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
    </div>
  )
}

export function UnconfirmedMark(): JSX.Element {
  const t = useTranslations(referencesCopy)
  return (
    <Chip variant="warning" size="sm">
      {t('fields.unconfirmed')}
    </Chip>
  )
}

export function ReferenceFactText({
  fact,
  children,
}: {
  fact: Pick<ReferenceFact<unknown>, 'confirmed'>
  children: ReactNode
}): JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {children}
      {!fact.confirmed && <UnconfirmedMark />}
    </span>
  )
}

export function OriginChip({ origin }: { origin: ReferenceOrigin }): JSX.Element {
  const t = useTranslations(referencesCopy)
  const variant = origin === 'person' ? 'success' : origin === 'documents' ? 'info' : 'muted'
  return (
    <Chip variant={variant} size="sm">
      {t(`decisions.origin.${origin}`)}
    </Chip>
  )
}

export function periodYears(period: ReferencePeriod): string {
  const from = period.start.slice(0, 4)
  const to = period.end?.slice(0, 4)
  if (!to) return `${from}–`
  return to !== from ? `${from}–${to}` : from
}

export function ReferenceSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="grid min-w-0 gap-2">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  )
}

export function ReferenceDecisionItem({ decision }: { decision: ReferenceDecision }): JSX.Element {
  const t = useTranslations(referencesCopy)
  return (
    <li className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip variant="outline" size="sm">
          {t(`decisions.kind.${decision.kind}`)}
        </Chip>
        <OriginChip origin={decision.origin} />
      </div>
      <p className="line-clamp-3 text-sm text-foreground">{decision.content}</p>
      {decision.sources.length > 0 && (
        <p className="truncate text-xs text-muted-foreground">
          {decision.sources
            .map((source) =>
              source.page
                ? t('decisions.source', { file: source.fileName, page: source.page })
                : t('decisions.sourceWithoutPage', { file: source.fileName }),
            )
            .join(' · ')}
        </p>
      )}
    </li>
  )
}

export function ReferencePermitItem({ permit }: { permit: ReferencePermit }): JSX.Element {
  const t = useTranslations(referencesCopy)
  const { locale } = useLocale()
  const issuer = [permit.authority, permit.issuedOn ? t('permits.issuedOn', { date: formatCalendarDate(permit.issuedOn, locale) }) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip variant="outline" size="sm">
          {t(`permits.kind.${permit.kind}`)}
        </Chip>
        {issuer && <span className="min-w-0 truncate text-xs text-muted-foreground">{issuer}</span>}
      </div>
      {permit.requirements.length > 0 && (
        <ul className="grid gap-1">
          {permit.requirements.map((requirement, index) => (
            <li key={index} className="flex min-w-0 items-start gap-2 text-sm">
              <Chip variant="muted" size="sm" className="mt-0.5">
                {t(`permits.requirementKind.${requirement.kind}`)}
              </Chip>
              <span className="line-clamp-2 min-w-0 text-foreground">{requirement.content}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
