'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { projectInitials } from '@/features/projects/lib/project-initials'
import { projectNameTail } from '@/features/projects/lib/project-name'
import type { Project } from '@/lib/db/schema/projects'
import { useTranslations } from '@/i18n'
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

const LAYERED_LINK =
  'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-control text-muted-foreground transition-colors duration-quick ease-out hover:bg-hover hover:text-foreground focus-visible:outline-none motion-reduce:transition-none'

export function ProjectSettingsLink({
  project,
  className,
}: {
  project: Pick<Project, 'id' | 'name'>
  className?: string
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <Link
      href={`/app/projects/${project.id}/settings`}
      aria-label={t('card.settingsAria', { name: project.name })}
      title={t('card.settings')}
      data-testid="project-settings-link"
      className={cn(LAYERED_LINK, 'size-7 pointer-coarse:size-11', FOCUS_RING, className)}
    >
      <Settings className="size-4" aria-hidden />
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
