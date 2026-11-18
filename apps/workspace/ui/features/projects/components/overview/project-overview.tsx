'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { BentoCell, BentoGrid, BentoTile, type BentoSpan } from '@/components/ui/bento'
import { Button } from '@/components/ui/button'
import { ProjectStatusMark } from '@/components/projects/project-status'
import type { ProjectRecordView } from '@/lib/projects/project-record-types'
import type { IntakeCounts, IntakeStatus } from '@/lib/project-intake/types'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { intakeShellCopy } from '@/i18n/namespaces/intake-shell'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { settingsCopy } from '@/i18n/namespaces/settings'
import { formatBytes, formatDate } from '@/lib/format'
import type { ProjectOverviewData } from '../../types'
import { settingsSectionHref } from '../../lib/settings-sections'
import { ProjectDeleteDialog } from '../project-delete-dialog'
import { ProjectLifecycleCard } from '../project-lifecycle-card'
import { useProjectLifecycle } from '../../lib/use-project-lifecycle'
import { ProjectRenameDialog } from '../project-rename-dialog'
import { ProjectRecord } from '../project-record'
import type { ProjectUsageView } from '../settings/usage-settings'
import { ActivityPanel, type ProjectActivityView } from './activity-panel'
import { DocumentsTile } from './documents-tile'
import { MembersTile, MemoryTile } from './live-tiles'
import { UsageTile } from './usage-tile'

export interface ProjectOverviewAccess {
  manage: boolean
  changeStatus: boolean
  writeMemory: boolean
  editProfile: boolean
  manageMembers: boolean
}

export interface OverviewSetupProgress {
  status: IntakeStatus
  counts: IntakeCounts | null
}

export interface ProjectOverviewProps {
  data: ProjectOverviewData
  activity: ProjectActivityView
  usage: ProjectUsageView | null
  projectRecord?: ProjectRecordView
  similar?: ReactNode
  setupOpen?: boolean
  setupProgress?: OverviewSetupProgress
  access: ProjectOverviewAccess
  inboundMailAddress?: ReactNode
}

export function ProjectOverview({
  data,
  activity,
  usage,
  projectRecord,
  similar,
  setupOpen = false,
  setupProgress,
  access,
  inboundMailAddress,
}: ProjectOverviewProps): JSX.Element {
  const id = data.id
  const usageSpan: BentoSpan = access.manageMembers ? 'major' : 'wide'
  const membersSpan: BentoSpan = usage ? 'small' : 'wide'
  const projectRecordSpan: BentoSpan = access.changeStatus ? 'major' : 'wide'
  return (
    <div className="flex flex-col gap-4">
      <BentoGrid data-testid="project-overview">
        <HeroTile
          data={data}
          activity={activity}
          access={access}
          setupOpen={setupOpen || setupProgress !== undefined}
          setupProgress={setupProgress}
        />
        <DocumentsTile
          documentCount={data.documentCount}
          totalFileSize={data.totalFileSize}
          recent={data.recentDocuments}
          href={settingsSectionHref(id, 'documents')}
        />
        <MemoryTile projectId={id} href={settingsSectionHref(id, 'memory')} />
        {/* Where people look at the project, so the address is handed out where the work starts (WOW §3.5). A row of its own. */}
        {inboundMailAddress}
        {usage && (
          <UsageTile usage={usage} href={settingsSectionHref(id, 'usage')} span={usageSpan} />
        )}
        {access.manageMembers && (
          <MembersTile
            projectId={id}
            href={settingsSectionHref(id, 'members')}
            span={membersSpan}
          />
        )}
        {projectRecord && <ProjectRecord projectId={id} projectRecord={projectRecord} span={projectRecordSpan} />}
        {/* The lifecycle (ADR-0098): pause, resume, close, reopen. Reopening is
            the one change a closed project allows. */}
        {access.changeStatus && (
          <BentoCell span={projectRecord ? 'small' : 'wide'}>
            <ProjectLifecycleCard
              projectId={id}
              lifecycle={data.lifecycle}
              profile={data.profile}
              canWriteMemory={access.writeMemory}
            />
          </BentoCell>
        )}
        {similar}
      </BentoGrid>
    </div>
  )
}

export function setupOpenNote({ status, counts }: OverviewSetupProgress, tSetup: Translator): string | undefined {
  if (status === 'reading') return tSetup('overview.reading')
  if (!counts) return undefined
  if (counts.decisiveOpen > 0) return tSetup('overview.questions', { count: counts.decisiveOpen })
  if (counts.contradictions > 0) return tSetup('overview.contradictions', { count: counts.contradictions })
  return counts.suggested > 0 ? tSetup('overview.review') : undefined
}

function HeroTile({
  data,
  activity,
  access,
  setupOpen,
  setupProgress,
}: {
  data: ProjectOverviewData
  activity: ProjectActivityView
  access: ProjectOverviewAccess
  setupOpen: boolean
  setupProgress?: OverviewSetupProgress
}): JSX.Element {
  const t = useTranslations(settingsCopy)
  const { locale } = useLocale()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const lifecycle = useProjectLifecycle({
    projectId: data.id,
    lifecycle: data.lifecycle,
    profile: data.profile,
    canWriteMemory: access.writeMemory,
  })
  const tProjects = useTranslations(projectsCopy)
  const tSetup = useTranslations(intakeShellCopy)
  const setupNote = setupProgress ? setupOpenNote(setupProgress, tSetup) : undefined
  const status = data.lifecycle.status
  const projectPath = `/app/projects/${encodeURIComponent(data.id)}`
  const summary = data.profileDisplay?.summary?.trim()

  const entries = [
    ...(access.manage
      ? [
          {
            type: 'item' as const,
            id: 'rename',
            label: t('project.overview.rename'),
            icon: Pencil,
            onSelect: () => setRenaming(true),
          },
        ]
      : []),
    ...(access.manage && access.changeStatus ? [{ type: 'separator' as const }] : []),
    ...(access.changeStatus && status === 'active'
      ? [{ type: 'item' as const, id: 'pause', label: tProjects('lifecycle.card.pause'), icon: PauseCircle, onSelect: () => void lifecycle.pause() }]
      : []),
    ...(access.changeStatus && status === 'paused'
      ? [{ type: 'item' as const, id: 'resume', label: tProjects('lifecycle.card.resume'), icon: PlayCircle, onSelect: () => void lifecycle.resume() }]
      : []),
    ...(access.changeStatus && status !== 'closed'
      ? [{ type: 'item' as const, id: 'close', label: tProjects('lifecycle.card.close'), icon: Lock, onSelect: lifecycle.requestClose }]
      : []),
    ...(access.changeStatus && status === 'closed'
      ? [{ type: 'item' as const, id: 'reopen', label: tProjects('lifecycle.card.reopen'), icon: LockOpen, onSelect: lifecycle.requestReopen }]
      : []),
    ...(access.changeStatus ? [{ type: 'separator' as const }] : []),
    ...(access.changeStatus
      ? [
          {
            type: 'item' as const,
            id: 'delete',
            label: t('project.overview.delete'),
            icon: Trash2,
            variant: 'destructive' as const,
            onSelect: () => setDeleting(true),
          },
        ]
      : []),
  ]

  const menu =
    entries.length > 0 ? (
      <ActionMenu
        mode="dropdown"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7"
            aria-label={t('project.overview.actions')}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        }
        entries={entries}
      />
    ) : undefined

  return (
    <BentoTile
      label={t('project.overview.createdOn', { date: formatDate(data.createdAt, locale) })}
      icon={CalendarDays}
      span="hero"
      action={menu}
      bodyClassName="gap-4 p-6 md:p-8"
      data-testid="overview-hero"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <p className="text-balance text-2xl font-medium md:text-3xl">
            {data.name}
          </p>
          <ProjectStatusMark project={{ status, closedOutcome: data.lifecycle.closedOutcome }} />
        </div>
        <p
          className={
            summary
              ? 'text-foreground/80 line-clamp-3 max-w-3xl text-pretty leading-relaxed'
              : 'text-muted-foreground max-w-3xl text-pretty leading-relaxed'
          }
        >
          {summary ?? t('project.overview.summaryEmpty')}
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t('project.overview.documentsCount', { count: data.documentCount })}
          {' · '}
          {formatBytes(data.totalFileSize, locale)}
        </p>
      </div>

      <ActivityPanel activity={activity} />

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`${projectPath}/chat?new=1`}>
            <MessageSquare className="size-4" aria-hidden />
            {t('project.overview.askAgent')}
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`${projectPath}/files`}>
            <FileText className="size-4" aria-hidden />
            {t('project.overview.openFiles')}
          </Link>
        </Button>
        {setupOpen && (
          <Button asChild variant="secondary">
            <Link href={`${projectPath}/setup`}>
              <Sparkles className="size-4" aria-hidden />
              {t('project.overview.openSetup')}
              {setupNote && (
                <span className="text-muted-foreground font-normal" data-testid="overview-setup-note">
                  · {setupNote}
                </span>
              )}
            </Link>
          </Button>
        )}
        {/* One way into the profile at a time: while the setup is open it is
            where the profile is filled, and a second button to the wizard read
            as a second, different thing to do. */}
        {access.editProfile && !setupOpen && (
          <Button asChild variant="secondary">
            <Link href={`${projectPath}/intake`}>
              <ClipboardList className="size-4" aria-hidden />
              {data.profileDisplay != null
                ? t('project.overview.editBrief')
                : t('project.overview.setUpBrief')}
            </Link>
          </Button>
        )}
      </div>

      {access.manage && (
        <ProjectRenameDialog
          projectId={data.id}
          projectName={data.name}
          open={renaming}
          onOpenChange={setRenaming}
        />
      )}
      {access.changeStatus && lifecycle.dialogs}
      {access.changeStatus && (
        <ProjectDeleteDialog
          projectId={data.id}
          projectName={data.name}
          open={deleting}
          onOpenChange={setDeleting}
        />
      )}
    </BentoTile>
  )
}
