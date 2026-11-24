'use client'

import type { JSX, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { RisoPrint } from '@/components/brand/riso-print'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PAGE_TITLE_CLASS } from '@/components/ui/page-header'
import { RaisedCard, RaisedCardBody, RaisedCardFooter } from '@/components/ui/raised-card'
import { SearchField } from '@/components/ui/search-field'
import { projectIdFromPathname } from '@/components/shell/org-sections'
import { projectMatchesQuery } from '@/features/projects/lib/project-search'
import type { Project } from '@/lib/db/schema/projects'
import { projectFactText, projectSiteAddress } from '@/lib/projects/site-address'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectActivity, ProjectDocCount, ProjectMailWaiting, ProjectOpenLink, ProjectOverviewLink } from './project-atoms'
import { getProjectStatus } from './project-status'

export interface ProjectOverviewProps {
  projects: Project[]
  docCounts: Record<string, number>
  viewerActivity?: Record<string, string>
  mailWaiting?: Record<string, number>
  autoOpenCreate?: boolean
  closeAction?: ReactNode
}

const STATUS_ORDER = { active: 0, paused: 1, closed: 2 } as const

export function overviewOrder(projects: readonly Project[], viewerActivity: Readonly<Record<string, string>>): Project[] {
  const touched = (project: Project): number =>
    new Date(viewerActivity[project.id] ?? project.profileUpdatedAt ?? project.createdAt).getTime()
  return [...projects].sort(
    (a, b) => STATUS_ORDER[getProjectStatus(a)] - STATUS_ORDER[getProjectStatus(b)] || touched(b) - touched(a)
  )
}

export function ProjectOverview({
  projects,
  docCounts,
  viewerActivity = {},
  mailWaiting = {},
  autoOpenCreate = false,
  closeAction,
}: ProjectOverviewProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const currentId = projectIdFromPathname(usePathname() ?? '')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () => overviewOrder(needle ? projects.filter((project) => projectMatchesQuery(project, needle)) : projects, viewerActivity),
    [projects, needle, viewerActivity]
  )

  return (
    <div className="flex flex-col gap-5" data-testid="project-overview">
      <header className="flex items-center justify-between gap-4">
        <h1 className={cn('min-w-0 text-balance', PAGE_TITLE_CLASS)}>{t('portfolio.title')}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <CreateProjectDialog defaultOpen={autoOpenCreate} tourAnchor={TOUR_ANCHORS.createProject} />
          {closeAction}
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          art={<RisoPrint id="vignetten/abstecken/empty" />}
          title={t('list.empty.title')}
          description={t('list.empty.description')}
          className="min-h-72 justify-center"
        />
      ) : (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('portfolio.searchPlaceholder')}
            label={t('list.searchAria')}
            clearLabel={t('list.searchReset')}
            className="w-full"
          />
          {shown.length === 0 ? (
            <EmptyState
              variant="bare"
              icon={Search}
              title={t('list.noMatch.title')}
              description={t('list.noMatch.description')}
              action={
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                  {t('list.noMatch.clear')}
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-overview-grid">
              {shown.map((project) => (
                <li key={project.id}>
                  <ProjectOverviewCard
                    project={project}
                    current={project.id === currentId}
                    docCount={docCounts[project.id] ?? 0}
                    activityAt={viewerActivity[project.id]}
                    mailWaiting={mailWaiting[project.id] ?? 0}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function ProjectOverviewCard({
  project,
  current,
  docCount,
  activityAt,
  mailWaiting,
}: {
  project: Project
  current: boolean
  docCount: number
  activityAt?: string
  mailWaiting: number
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  const status = getProjectStatus(project)
  const line =
    status === 'active'
      ? [projectSiteAddress(project), projectFactText(project, 'project_phase')].filter(Boolean).join(' · ')
      : t(`list.filter.${status}`)
  return (
    <RaisedCard
      interactive
      className={cn('h-full', current && 'ring-foreground ring-[1.5px]')}
      data-testid="project-overview-card"
      data-status={status}
      aria-current={current ? 'page' : undefined}
    >
      <RaisedCardBody className="flex min-h-[92px] flex-col justify-between gap-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-sm font-medium">
            <ProjectOpenLink project={project} />
          </h2>
          <ProjectOverviewLink project={project} className="-mr-1.5 -mt-1.5 shrink-0" />
        </div>
        {line && (
          <p className="text-muted-foreground text-meta truncate" title={line} data-testid="project-overview-line">
            {line}
          </p>
        )}
      </RaisedCardBody>
      <RaisedCardFooter>
        <ProjectDocCount count={docCount} />
        <ProjectActivity project={project} activityAt={activityAt} showLabel={false} />
        <ProjectMailWaiting project={project} count={mailWaiting} className="-mr-2 ml-auto" />
      </RaisedCardFooter>
    </RaisedCard>
  )
}
