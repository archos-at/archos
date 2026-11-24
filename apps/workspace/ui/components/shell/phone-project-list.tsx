'use client'

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronRight, Plus, Settings } from 'lucide-react'

import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { switcherSections, type ProjectSwitcherProject } from './project-list'
import { readRecentProjectIds } from './recent-projects'
import { NEW_PROJECT_PATH, PROJECT_OVERVIEW_PATH } from './landing'

const FOOT_ROW_CLASS = cn(
  'text-foreground flex min-h-14 items-center gap-3 px-4 text-[15px] outline-none',
  PRESSABLE,
  FOCUS_RING_INSET,
  'active:bg-desk'
)

export interface PhoneProjectListProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  onDone: () => void
}

export function PhoneProjectList({
  projects,
  activeProjectId,
  onDone,
}: PhoneProjectListProps): JSX.Element {
  const t = useTranslations(navCopy)
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [recentIds] = React.useState<string[]>(() => readRecentProjectIds())
  const [expanded, setExpanded] = React.useState(false)
  const unfolded = React.useRef<HTMLDivElement>(null)
  const showAll = (): void => {
    setExpanded(true)
    // The row that was pressed is gone; the first project it unfolded takes the focus.
    requestAnimationFrame(() => unfolded.current?.querySelector<HTMLElement>('li button')?.focus())
  }

  const sections = switcherSections(projects, activeProjectId, recentIds, query)
  const choose = (projectId: string): void => {
    onDone()
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const row = (project: ProjectSwitcherProject): JSX.Element => (
    <SwitcherRow
      key={project.id}
      project={project}
      current={project.id === activeProjectId}
      onChoose={() => choose(project.id)}
      onSettings={onDone}
    />
  )

  return (
    <div data-slot="phone-project-list" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2">
        <SearchField
          value={query}
          onChange={setQuery}
          label={t('projectSheet.searchLabel')}
          placeholder={t('projectSheet.searchPlaceholder')}
          clearLabel={t('projectSheet.clearSearch')}
          type="search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {sections.kind === 'search' ? (
          sections.matches.length > 0 ? (
            <ul aria-label={t('projectSheet.matches')}>{sections.matches.map(row)}</ul>
          ) : (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              {t('projectSheet.noMatch')}
            </p>
          )
        ) : (
          <>
            {sections.shortlist.length > 0 && (
              <SwitcherGroup
                label={
                  sections.fromRecents ? t('projectSheet.recent') : t('projectSwitcher.projects')
                }
              >
                {sections.shortlist.map(row)}
              </SwitcherGroup>
            )}
            {sections.rest.length > 0 &&
              (expanded ? (
                <div ref={unfolded}>
                  <SwitcherGroup label={t('projectSheet.others')}>
                    {sections.rest.map(row)}
                  </SwitcherGroup>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={showAll}
                  aria-expanded={false}
                  data-testid="phone-project-list-show-all"
                  className={cn(
                    'text-muted-foreground flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] outline-none',
                    PRESSABLE,
                    FOCUS_RING_INSET,
                    'active:bg-desk'
                  )}
                >
                  <span className="min-w-0 flex-1">{t('projectSwitcher.showAll')}</span>
                  <span className="shrink-0 text-xs tabular-nums">{sections.rest.length}</span>
                  <ChevronDown className="size-4 shrink-0" aria-hidden />
                </button>
              ))}
          </>
        )}
        {/* The way to every project, closed ones included: the list's last
              row, with the list it continues. Pinned to the sheet's foot as a
              grey bar it stood a screen away from the projects it belongs to. */}
        <Link href={PROJECT_OVERVIEW_PATH} onClick={onDone} className={FOOT_ROW_CLASS}>
          <span className="min-w-0 flex-1">{t('projectSwitcher.overview')}</span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Link>
        <Link href={NEW_PROJECT_PATH} onClick={onDone} className={FOOT_ROW_CLASS}>
          <span className="min-w-0 flex-1">{t('projectSwitcher.newProject')}</span>
          <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function SwitcherGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="pt-2">
      <SectionLabel as="h3" id={id} className="block px-4 pt-2 pb-1">
        {label}
      </SectionLabel>
      <ul>{children}</ul>
    </section>
  )
}

function SwitcherRow({
  project,
  current,
  onChoose,
  onSettings,
}: {
  project: ProjectSwitcherProject
  current: boolean
  onChoose: () => void
  onSettings: () => void
}): JSX.Element {
  const t = useTranslations(navCopy)
  const tProjects = useTranslations(projectsCopy)
  const quiet = project.status === 'paused' || project.status === 'closed'
  return (
    <li className="flex items-center pr-2">
      <button
        type="button"
        onClick={onChoose}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'flex min-h-14 min-w-0 flex-1 items-center gap-3 pr-2 pl-4 text-left outline-none',
          PRESSABLE,
          FOCUS_RING_INSET,
          'active:bg-desk'
        )}
      >
        <span
          className={cn(
            'text-foreground min-w-0 flex-1 truncate text-[15px]',
            current && 'font-semibold'
          )}
        >
          {project.name}
        </span>
        {quiet && project.status && (
          <span className="text-muted-foreground shrink-0 text-xs">
            {tProjects(`card.status.${project.status}`)}
          </span>
        )}
        {current && <Check className="text-foreground size-4 shrink-0" aria-hidden />}
      </button>
      <Link
        href={`/app/projects/${project.id}/settings`}
        onClick={onSettings}
        aria-label={t('projectSwitcher.projectSettings', { name: project.name })}
        title={t('projectSwitcher.projectSettingsTitle')}
        className={cn(
          'text-muted-foreground rounded-control grid size-11 shrink-0 place-items-center outline-none',
          PRESSABLE,
          FOCUS_RING_INSET,
          'active:bg-desk'
        )}
      >
        <Settings className="size-4" aria-hidden />
      </Link>
    </li>
  )
}
