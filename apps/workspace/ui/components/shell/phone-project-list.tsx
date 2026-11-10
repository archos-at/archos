'use client'

/**
 * The project list on a phone: what „Projekt wechseln“ opens inside „Mehr“
 * (`PhoneMoreSheet`).
 *
 * Until 2026-11-10 it was a sheet of its own, opened from a project press in
 * the phone's top band. The selector moved to „Mehr“: the band names the
 * project as a quiet line and no longer spends 56px of every page on a press
 * used a few times a day. The list is the same one: a search, the projects
 * opened last, the rest, „Alle Projekte ansehen“, every row 56px, in the order
 * the rail's selector lists them (`project-list.ts`).
 *
 * ORDER. The projects this reader opened last come first (`recent-projects`),
 * because on site the switch is almost always between the two or three
 * projects of this week; then every other running project by name. Typing
 * folds both into one list of matches. "Alle Projekte" at the foot goes to the
 * projects home, where closed projects and the full search live.
 *
 * The search field is not focused when the list opens. Focus would raise the
 * keyboard over the very rows the reader opened it to tap.
 */

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight } from 'lucide-react'

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

export interface PhoneProjectListProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  /** A project was chosen or „Alle Projekte ansehen“ pressed: the sheet that holds the list closes. */
  onDone: () => void
}

export function PhoneProjectList({ projects, activeProjectId, onDone }: PhoneProjectListProps): JSX.Element {
  const t = useTranslations(navCopy)
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  // Read on every mount, which is every opening: the reader may have moved
  // between projects since the list last stood.
  const [recentIds] = React.useState<string[]>(() => readRecentProjectIds())

  const sections = switcherSections(projects, activeProjectId, recentIds, query)
  const choose = (projectId: string): void => {
    onDone()
    // Switching into a project lands on its chat, as the desktop switcher does.
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const row = (project: ProjectSwitcherProject): JSX.Element => (
    <SwitcherRow
      key={project.id}
      project={project}
      current={project.id === activeProjectId}
      onChoose={() => choose(project.id)}
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
              {sections.recent.length > 0 && (
                <SwitcherGroup label={t('projectSheet.recent')}>
                  {sections.recent.map(row)}
                </SwitcherGroup>
              )}
              {sections.rest.length > 0 && (
                <SwitcherGroup
                  label={
                    sections.recent.length > 0
                      ? t('projectSheet.others')
                      : t('projectSwitcher.projects')
                  }
                >
                  {sections.rest.map(row)}
                </SwitcherGroup>
              )}
            </>
          )}
          {/* The way to every project, closed ones included: the list's last
              row, with the list it continues. Pinned to the sheet's foot as a
              grey bar it stood a screen away from the projects it belongs to. */}
          <Link
            href="/app/projects"
            onClick={onDone}
            className={cn(
              'text-foreground flex min-h-14 items-center gap-3 px-4 text-[15px] outline-none',
              PRESSABLE,
              FOCUS_RING_INSET,
              'active:bg-desk'
            )}
          >
            <span className="min-w-0 flex-1">{t('projectSwitcher.viewAllProjects')}</span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
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
      <SectionLabel as="h3" id={id} className="block px-4 pb-1 pt-2">
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
}: {
  project: ProjectSwitcherProject
  current: boolean
  onChoose: () => void
}): JSX.Element {
  const tProjects = useTranslations(projectsCopy)
  const quiet = project.status === 'paused' || project.status === 'closed'
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 px-4 text-left outline-none',
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
    </li>
  )
}
