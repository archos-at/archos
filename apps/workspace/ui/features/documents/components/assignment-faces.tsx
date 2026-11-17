'use client'

import { AvatarStack } from '@/components/ui/avatar-stack'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileAssignee } from './project-file-workspace'
import { cn } from '@/lib/utils'
import { UserRound } from 'lucide-react'

export function AssignmentFaces({
  assignees,
  faceOnly = false,
  className,
}: {
  assignees: readonly FileAssignee[] | undefined
  faceOnly?: boolean
  className?: string
}) {
  const t = useTranslations(filesCopy)
  if ((!assignees || assignees.length === 0) && faceOnly) {
    return (
      <span
        className={cn('border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed', className)}
        aria-hidden
      >
        <UserRound className="size-3.5" />
      </span>
    )
  }
  if (!assignees || assignees.length === 0) {
    return (
      <span
        className={cn('flex min-w-0 items-center text-xs text-muted-foreground', className)}
        title={t('assignment.unassigned')}
        data-testid="assignment-unassigned"
      >
        <span
          aria-hidden
          className="border-border text-muted-foreground hidden size-5 shrink-0 items-center justify-center rounded-full border border-dashed phone:flex"
        >
          <UserRound className="size-3" />
        </span>
        <span className="truncate phone:sr-only">{t('assignment.unassigned')}</span>
      </span>
    )
  }
  const people = assignees.map((person) => ({
    userId: person.userId,
    name: person.name || person.email || person.userId,
    profilePictureUrl: person.profilePictureUrl,
  }))
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)} title={people.map((p) => p.name).join(', ')}>
      <AvatarStack people={people} size="sm" max={3} tone="neutral" /* Dateien: a face is no verdict, so no hue */ />
    </span>
  )
}
