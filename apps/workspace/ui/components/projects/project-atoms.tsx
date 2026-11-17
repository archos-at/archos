'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Clock3, FileText, LayoutDashboard, Mail, MessageSquare } from 'lucide-react'
import { useMemo } from 'react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { projectInitials } from '@/features/projects/lib/project-initials'
import { projectNameTail } from '@/features/projects/lib/project-name'
import type { Project } from '@/lib/db/schema/projects'
import { projectSiteAddress } from '@/lib/projects/site-address'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { useLocale, useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'

export function ProjectOpenLink({
  project,
  className,
}: {
  project: Pick<Project, 'id' | 'name'>
  className?: string
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <Link
      href={`/app/projects/${project.id}/chat`}
      aria-label={t('card.open', { name: project.name })}
      className={cn(
        'block min-w-0 after:absolute after:inset-0 after:rounded-surface focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/60',
        className,
      )}
    >
      {/* Cut in the MIDDLE: what tells two projects of one office apart is the
          end of the name ("… Neubau Gästetrakt"), the part an end ellipsis
          throws away first, and on a phone that is most names. */}
      {/* `whitespace-pre` on the two halves: each is its own flex item, and a
          flex item drops the space at its edge, which is exactly where the cut
          falls ("Wohnbau" + "Seestadt" would read "WohnbauSeestadt"). */}
      <MiddleTruncate
        text={project.name}
        tail={projectNameTail(project.name)}
        className="[&>span]:whitespace-pre"
      />
    </Link>
  )
}

export function ProjectLocationLine({
  project,
  className,
}: {
  project: Pick<Project, 'profile'>
  className?: string
}): JSX.Element | null {
  const address = projectSiteAddress(project)
  if (!address) return null
  return (
    <p
      title={address}
      data-testid="project-location"
      className={cn('truncate text-xs text-muted-foreground', className)}
    >
      {address}
    </p>
  )
}

export function ProjectActivity({
  project,
  activityAt,
  showLabel = true,
  compact = false,
  className,
}: {
  project: Pick<Project, 'profileUpdatedAt' | 'createdAt'>
  activityAt?: string
  showLabel?: boolean
  compact?: boolean
  className?: string
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  const { locale } = useLocale()

  const fallback = project.profileUpdatedAt ?? project.createdAt
  const iso = useMemo(
    () => (activityAt ? new Date(activityAt).toISOString() : new Date(fallback).toISOString()),
    [activityAt, fallback],
  )

  const label = activityAt ? t('card.yourActivity') : t('card.lastActivity')
  const Icon = activityAt ? MessageSquare : Clock3

  return (
    <>
      {showLabel ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className={cn(compact && 'sr-only')}>{label}</span>
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <time
        dateTime={iso}
        title={`${label}: ${formatAbsoluteTime(iso, locale)}`}
        suppressHydrationWarning
        className={cn('truncate text-xs tabular-nums text-muted-foreground', className)}
      >
        {formatRelativeTime(iso, locale)}
      </time>
    </>
  )
}

export function ProjectDocCount({ count, className }: { count: number; className?: string }): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <span className={cn('flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground', className)}>
      <FileText className="size-3.5 shrink-0" aria-hidden />
      {t('card.docLabel', { count, unit: count === 1 ? t('card.document') : t('card.documents') })}
    </span>
  )
}

const LAYERED_LINK =
  'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-control text-muted-foreground transition-colors duration-quick ease-out hover:bg-hover hover:text-foreground focus-visible:outline-none motion-reduce:transition-none'

const LAYERED_LINK_LABELLED = 'h-8 px-2.5 text-xs pointer-coarse:h-11 pointer-coarse:px-3'

export function ProjectOverviewLink({
  project,
  showLabel = false,
  className,
}: {
  project: Pick<Project, 'id' | 'name'>
  showLabel?: boolean
  className?: string
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <Link
      href={`/app/projects/${project.id}/settings`}
      aria-label={t('card.overviewAria', { name: project.name })}
      className={cn(
        LAYERED_LINK,
        showLabel ? LAYERED_LINK_LABELLED : 'size-8 pointer-coarse:size-11',
        FOCUS_RING,
        className,
      )}
    >
      <LayoutDashboard className="size-3.5" aria-hidden />
      {showLabel && <span>{t('card.overview')}</span>}
    </Link>
  )
}

export function ProjectMailWaiting({
  project,
  count,
  className,
}: {
  project: Pick<Project, 'id' | 'name'>
  count: number
  className?: string
}): JSX.Element | null {
  const t = useTranslations(projectsCopy)
  if (!Number.isFinite(count) || count <= 0) return null
  return (
    <Link
      href={`/app/projects/${encodeURIComponent(project.id)}/files/mail`}
      aria-label={t('card.mailWaitingAria', { count, name: project.name })}
      data-testid="project-mail-waiting"
      className={cn(
        LAYERED_LINK,
        LAYERED_LINK_LABELLED,
        FOCUS_RING,
        className,
      )}
    >
      <Mail className="size-3.5" aria-hidden />
      <span className="tabular-nums">{t('card.mailWaiting', { count })}</span>
    </Link>
  )
}

export function ProjectInitialsTile({
  project,
  className,
}: {
  project: Pick<Project, 'name'>
  className?: string
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-control bg-muted text-xs font-medium tracking-wide text-muted-foreground transition-colors duration-quick ease-out group-hover:bg-selected group-hover:text-foreground motion-reduce:transition-none',
        className,
      )}
    >
      {projectInitials(project.name)}
    </span>
  )
}
