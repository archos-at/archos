'use client'

import type { JSX, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import { RisoPrint } from '@/components/brand/riso-print'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Item } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { PAGE_TITLE_CLASS } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { projectIdFromPathname } from '@/components/shell/org-sections'
import { overviewMatchesQuery, type OverviewProject } from '@/lib/projects/overview-project'
import { overviewOrder } from '@/lib/projects/overview-order'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectActivity, ProjectOpenLink, ProjectSettingsLink } from './project-atoms'
import { getProjectStatus } from './project-status'

export interface ProjectOverviewProps {
  projects: OverviewProject[]
  viewerActivity?: Record<string, string>
  autoOpenCreate?: boolean
  closeAction?: ReactNode
  /** What scrolls with the projects under the standing title and search (the office's „Kürzlich gelöscht“). */
  after?: ReactNode
}

export const OVERVIEW_CARD_SLOTS = 6

export function ProjectOverview({
  projects,
  viewerActivity = {},
  autoOpenCreate = false,
  closeAction,
  after,
}: ProjectOverviewProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const currentId = projectIdFromPathname(usePathname() ?? '')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      overviewOrder(
        needle ? projects.filter((project) => overviewMatchesQuery(project, needle)) : projects,
        viewerActivity
      ),
    [projects, needle, viewerActivity]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-overview">
      <div
        className="flex shrink-0 flex-col gap-5 px-6 pt-2 pb-4 md:pt-6"
        data-testid="project-overview-top"
      >
        <header
          className="flex flex-wrap items-center gap-x-4 gap-y-3"
          data-testid="project-overview-header"
        >
          <h1 className={cn('grow text-balance', PAGE_TITLE_CLASS)}>{t('portfolio.title')}</h1>
          <div className="order-last shrink-0 sm:order-none">
            <CreateProjectDialog
              defaultOpen={autoOpenCreate}
              tourAnchor={TOUR_ANCHORS.createProject}
            />
          </div>
          {closeAction}
        </header>
        {projects.length > 0 && (
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('portfolio.searchPlaceholder')}
            label={t('list.searchAria')}
            clearLabel={t('list.searchReset')}
            className="w-full"
          />
        )}
      </div>

      <div
        className="scroll-fade-y flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-1 pb-6"
        data-testid="project-overview-scroll"
      >
        {projects.length === 0 ? (
          <EmptyState
            art={<RisoPrint id="vignetten/abstecken/empty" />}
            title={t('list.empty.title')}
            description={t('list.empty.description')}
            className="min-h-72 justify-center"
          />
        ) : (
          <>
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
            ) : needle ? (
              <ProjectOverviewList
                label={t('portfolio.matches')}
                projects={shown}
                currentId={currentId}
                viewerActivity={viewerActivity}
              />
            ) : (
              <>
                <ul
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  data-testid="project-overview-grid"
                >
                  {shown.slice(0, OVERVIEW_CARD_SLOTS).map((project) => (
                    <li key={project.id}>
                      <ProjectOverviewCard project={project} current={project.id === currentId} />
                    </li>
                  ))}
                </ul>
                {shown.length > OVERVIEW_CARD_SLOTS && (
                  <section className="flex flex-col gap-2" aria-labelledby="project-overview-more">
                    <SectionLabel as="h2" id="project-overview-more" className="px-1">
                      {t('portfolio.more')}
                    </SectionLabel>
                    <ProjectOverviewList
                      projects={shown.slice(OVERVIEW_CARD_SLOTS)}
                      currentId={currentId}
                      viewerActivity={viewerActivity}
                    />
                  </section>
                )}
              </>
            )}
          </>
        )}
        {after}
      </div>
    </div>
  )
}

export function projectOverviewLine(
  project: Pick<OverviewProject, 'status' | 'place' | 'phase'>,
  statusLabel: (status: 'paused' | 'closed') => string
): string | null {
  const status = getProjectStatus(project)
  if (status !== 'active') return statusLabel(status)
  return [project.place, project.phase].filter(Boolean).join(' · ') || null
}

function ProjectOverviewCard({
  project,
  current,
}: {
  project: OverviewProject
  current: boolean
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  const status = getProjectStatus(project)
  const line = projectOverviewLine(project, (quiet) => t(`list.filter.${quiet}`))
  return (
    <div
      className={cn(
        'bg-sheet rounded-surface duration-quick relative flex h-full flex-col gap-1 p-3 shadow-sm transition-shadow ease-out hover:shadow-md motion-reduce:transition-none',
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
        <ProjectSettingsLink
          project={project}
          className="relative z-10 -mt-1 -mr-1 shrink-0 pointer-coarse:-my-3 pointer-coarse:-mr-3"
        />
      </div>
      {line && (
        <p
          className="text-muted-foreground text-meta truncate"
          title={line}
          data-testid="project-overview-line"
        >
          {line}
        </p>
      )}
    </div>
  )
}

function ProjectOverviewList({
  projects,
  currentId,
  viewerActivity,
  label,
}: {
  projects: readonly OverviewProject[]
  currentId: string | null | undefined
  viewerActivity: Readonly<Record<string, string>>
  label?: string
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <ul
      aria-label={label}
      className="bg-sheet rounded-surface divide-border flex flex-col divide-y overflow-hidden shadow-sm"
      data-testid="project-overview-list"
    >
      {projects.map((project) => {
        const line = projectOverviewLine(project, (quiet) => t(`list.filter.${quiet}`))
        const current = project.id === currentId
        return (
          <Item
            as="li"
            key={project.id}
            className="has-[a:focus-visible]:bg-hover relative gap-3 py-2 pr-2 pl-3 pointer-coarse:min-h-14"
            data-testid="project-overview-row"
            data-status={getProjectStatus(project)}
            data-current={current ? '' : undefined}
            aria-current={current ? 'true' : undefined}
          >
            <div className="min-w-0 flex-1">
              <p className="text-name min-w-0 font-medium">
                <ProjectOpenLink project={project} className="after:rounded-none" />
              </p>
              {line && (
                <p
                  className="text-muted-foreground text-meta truncate"
                  title={line}
                  data-testid="project-overview-line"
                >
                  {line}
                </p>
              )}
            </div>
            <ProjectActivity
              project={project}
              activityAt={viewerActivity[project.id]}
              className="relative z-10 w-24 shrink-0 sm:w-28 max-sm:[&>svg]:hidden"
            />
            <ProjectSettingsLink project={project} className="shrink-0" />
          </Item>
        )
      })}
    </ul>
  )
}
