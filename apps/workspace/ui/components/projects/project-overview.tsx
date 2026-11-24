'use client'

import type { JSX, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { RisoPrint } from '@/components/brand/riso-print'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PAGE_TITLE_CLASS } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { projectIdFromPathname } from '@/components/shell/org-sections'
import { projectMatchesQuery } from './project-search'
import type { Project } from '@/lib/db/schema/projects'
import { projectCity, projectFactText } from '@/lib/projects/site-address'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectOpenLink, ProjectSettingsLink } from './project-atoms'
import { getProjectStatus } from './project-status'

export interface ProjectOverviewProps {
  projects: Project[]
  viewerActivity?: Record<string, string>
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
  viewerActivity = {},
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
                  <ProjectOverviewCard project={project} current={project.id === currentId} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export function projectOverviewLine(project: Project, statusLabel: (status: 'paused' | 'closed') => string): string | null {
  const status = getProjectStatus(project)
  if (status !== 'active') return statusLabel(status)
  return [projectCity(project), projectFactText(project, 'project_phase')].filter(Boolean).join(' · ') || null
}

function ProjectOverviewCard({ project, current }: { project: Project; current: boolean }): JSX.Element {
  const t = useTranslations(projectsCopy)
  const status = getProjectStatus(project)
  const line = projectOverviewLine(project, (quiet) => t(`list.filter.${quiet}`))
  return (
    <div
      className={cn(
        'bg-sheet relative flex h-[92px] flex-col justify-between rounded-[10px] p-3 shadow-sm transition-shadow duration-quick ease-out hover:shadow-md motion-reduce:transition-none',
        current && 'ring-foreground ring-[1.5px]'
      )}
      data-testid="project-overview-card"
      data-status={status}
      aria-current={current ? 'page' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-name min-w-0 font-medium">
          <ProjectOpenLink project={project} />
        </h2>
        <ProjectSettingsLink project={project} className="relative z-10 -mr-1 -mt-1 shrink-0" />
      </div>
      {line && (
        <p className="text-muted-foreground text-meta truncate" title={line} data-testid="project-overview-line">
          {line}
        </p>
      )}
    </div>
  )
}
