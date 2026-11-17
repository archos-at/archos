'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, ChevronsUpDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { projectInitials, switcherSections, type ProjectSwitcherProject } from './project-list'
import { readRecentProjectIds } from './recent-projects'

export type { ProjectSwitcherProject } from './project-list'

export interface ProjectSwitcherProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  collapsed?: boolean
}

const TRIGGER_CLASS = 'h-10 w-full justify-between gap-1 pr-1.5 pl-3 text-left pointer-coarse:h-11'

const TILE_CLASS = 'size-9 min-w-0 p-0 pointer-coarse:size-11'

const GROUP_CLASS =
  'p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground'

export function ProjectSwitcher({ projects, activeProjectId, collapsed }: ProjectSwitcherProps) {
  const router = useRouter()
  const t = useTranslations(navCopy)
  const tProjects = useTranslations(projectsCopy)
  const active = projects.find((p) => p.id === activeProjectId)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [recentIds, setRecentIds] = React.useState<string[]>([])
  const [cursor, setCursor] = React.useState('')

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) {
      const recent = readRecentProjectIds()
      setRecentIds(recent)
      setQuery('')
      const first = switcherSections(projects, activeProjectId, recent, '')
      const order = first.kind === 'browse' ? [...first.recent, ...first.rest] : first.matches
      setCursor(order.find((project) => project.id !== activeProjectId)?.id ?? '')
    }
  }

  const name = active?.name ?? t('projectSwitcher.select')
  const triggerLabel = active ? t('projectSwitcher.switchCurrent', { name: active.name }) : t('projectSwitcher.select')
  const sections = switcherSections(projects, activeProjectId, recentIds, query)

  const choose = (projectId: string): void => {
    setOpen(false)
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const item = (project: ProjectSwitcherProject): React.JSX.Element => {
    const isCurrent = project.id === activeProjectId
    const quiet = project.status === 'paused' || project.status === 'closed'
    return (
      <CommandItem key={project.id} value={project.id} onSelect={() => choose(project.id)} className="gap-2.5">
        <span className={cn('min-w-0 flex-1 truncate', isCurrent && 'font-medium')}>{project.name}</span>
        {quiet && project.status && (
          <span className="text-muted-foreground shrink-0 text-xs">{tProjects(`card.status.${project.status}`)}</span>
        )}
        {isCurrent && <Check className="size-4 shrink-0" aria-hidden />}
      </CommandItem>
    )
  }

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="secondary"
        data-project-selector=""
        aria-label={triggerLabel}
        className={collapsed ? TILE_CLASS : TRIGGER_CLASS}
      >
        {collapsed ? (
          <span aria-hidden data-slot="project-initials" className="text-xs leading-none font-semibold">
            {projectInitials(name)}
          </span>
        ) : (
          <>
            <MiddleTruncate text={name} tail={12} className="min-w-0 flex-1 text-[13px] font-medium" />
            <ChevronsUpDown className="text-muted-foreground size-3.5" aria-hidden />
          </>
        )}
      </Button>
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{name}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent
        align="start"
        side={collapsed ? 'right' : 'bottom'}
        sideOffset={collapsed ? 22 : 6}
        className={cn('p-0 motion-reduce:animate-none', collapsed ? 'w-60' : 'w-(--radix-popover-trigger-width)')}
      >
        {/* The phone's sheet in a popover: a search first (a dozen running
            projects is past what a reader scans), then the three opened last,
            then the rest. One order on both shapes (`project-list.ts`). */}
        {/* Rows at the rail's 13px, so a list as narrow as its press still holds a project's whole name. */}
        <Command shouldFilter={false} loop value={cursor} onValueChange={setCursor} label={t('projectSwitcher.switchHeading')} className="[&_[cmdk-item]]:text-[13px]">
          <CommandInput
            value={query}
            onValueChange={(next) => {
              setQuery(next)
              const found = switcherSections(projects, activeProjectId, recentIds, next)
              const order = found.kind === 'browse' ? [...found.recent, ...found.rest] : found.matches
              setCursor(order[0]?.id ?? 'all-projects')
            }}
            placeholder={t('projectSheet.searchPlaceholder')}
            aria-label={t('projectSheet.searchLabel')}
          />
          <CommandList className="max-h-[min(24rem,60dvh)] p-0">
            {sections.kind === 'search' ? (
              sections.matches.length > 0 ? (
                <CommandGroup className={GROUP_CLASS}>{sections.matches.map(item)}</CommandGroup>
              ) : (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">{t('projectSheet.noMatch')}</p>
              )
            ) : (
              <>
                {sections.recent.length > 0 && (
                  <CommandGroup heading={t('projectSheet.recent')} className={GROUP_CLASS}>
                    {sections.recent.map(item)}
                  </CommandGroup>
                )}
                {sections.rest.length > 0 && (
                  <CommandGroup
                    heading={sections.recent.length > 0 ? t('projectSheet.others') : t('projectSwitcher.projects')}
                    className={GROUP_CLASS}
                  >
                    {sections.rest.map(item)}
                  </CommandGroup>
                )}
              </>
            )}
            <CommandGroup className="p-1">
              <CommandItem
                value="all-projects"
                onSelect={() => {
                  setOpen(false)
                  router.push('/app/projects')
                }}
                className="gap-2.5"
              >
                <span className="min-w-0 flex-1">{t('projectSwitcher.viewAllProjects')}</span>
                <ChevronRight className="text-muted-foreground size-4" aria-hidden />
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
