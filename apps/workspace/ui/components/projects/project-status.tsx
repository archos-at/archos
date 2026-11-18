'use client'

import type { JSX } from 'react'
import type { CSSProperties } from 'react'
import { Activity, Lock, PauseCircle } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import type { Project } from '@/lib/db/schema/projects'
import { toProjectStatus, type ProjectOutcome, type ProjectStatus } from '@/lib/projects/project-status'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'

export type { ProjectStatus }

export function getProjectStatus(project: Pick<Project, 'status'>): ProjectStatus {
  return toProjectStatus(project.status)
}

const STATUS_STYLE: Record<ProjectStatus, CSSProperties | undefined> = {
  active: {
    backgroundColor:
      'var(--status-active-tint, color-mix(in oklch, var(--status-active, var(--text-color-feedback-success)) 14%, transparent))',
    color: 'var(--status-active-text, var(--status-active, var(--text-color-feedback-success)))',
  },
  paused: undefined,
  closed: undefined,
}

const STATUS_VARIANT: Record<ProjectStatus, 'success' | 'muted' | 'outline'> = {
  active: 'success',
  paused: 'outline',
  closed: 'muted',
}

const STATUS_ICON: Record<ProjectStatus, typeof Activity> = {
  active: Activity,
  paused: PauseCircle,
  closed: Lock,
}

interface ProjectStatusChipProps {
  status: ProjectStatus
  outcome?: ProjectOutcome | null
  size?: 'sm' | 'md'
}

export function ProjectStatusChip({ status, outcome = null, size = 'md' }: ProjectStatusChipProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const Icon = STATUS_ICON[status]
  const label = status === 'closed' && outcome === 'cancelled' ? t('card.status.cancelled') : t(`card.status.${status}`)
  return (
    <Chip variant={STATUS_VARIANT[status]} size={size} style={STATUS_STYLE[status]}>
      <Icon aria-hidden />
      {label}
    </Chip>
  )
}

export function ProjectStatusMark({
  project,
  size = 'sm',
}: {
  project: Pick<Project, 'status' | 'closedOutcome'>
  size?: 'sm' | 'md'
}): JSX.Element | null {
  const status = getProjectStatus(project)
  if (status === 'active') return null
  return <ProjectStatusChip status={status} outcome={project.closedOutcome} size={size} />
}

export function ProjectClosedChip({ projectName, className }: { projectName?: string | null; className?: string }): JSX.Element {
  const t = useTranslations(projectsCopy)
  const label = projectName ? t('lifecycle.fileChip', { name: projectName }) : t('lifecycle.fileChipNoName')
  return (
    <Chip variant="muted" size="sm" className={className} title={label}>
      <Lock aria-hidden />
      <span className="max-w-[16rem] truncate">{label}</span>
    </Chip>
  )
}
