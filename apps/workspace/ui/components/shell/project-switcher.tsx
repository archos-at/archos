'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { switcherSections, type ProjectSwitcherProject } from './project-list'
import { ProjectMark } from './project-mark'
import { readRecentProjectIds } from './recent-projects'

export type { ProjectSwitcherProject } from './project-list'

export interface ProjectSwitcherProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  collapsed?: boolean
}

/**
 * The switcher is the heading of the project's sections, so it is set as one:
 * no box, the name in ink at 14px and on two lines before it is cut (the end
 * of a name, „Baufeld D12", is what tells sibling projects apart), the mark
 * centred on the icons' axis and the name on the labels' edge. It was a white
 * card with a hairline and a shadow, the one raised box on the rail. A press
 * on the grey band is white (the tonal secondary, D4), so hover and open fill
 * it white and the mark turns to the one grey.
 */
const TRIGGER_CLASS = cn(
  'group/switcher flex min-h-9 w-full items-center gap-[9px] rounded-control px-2.5 py-2 text-left pointer-coarse:min-h-11',
  'transition-[color,background-color,scale] duration-quick ease-out',
  'hover:bg-on-sunken data-[state=open]:bg-on-sunken active:scale-[0.98] motion-reduce:transition-none',
  'outline-none',
  FOCUS_RING_INSET,
)

/** The icon rail's tile: a nav tile's 36px square on the rail's 32px axis. */
const TILE_CLASS = 'size-9 min-h-0 justify-center p-0 pointer-coarse:size-9 pointer-coarse:min-h-0'

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

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    // Read on every open: the reader may have moved between projects since.
    if (next) {
      setRecentIds(readRecentProjectIds())
      setQuery('')
    }
  }

  const name = active?.name ?? t('projectSwitcher.select')
  const triggerLabel = active ? t('projectSwitcher.switchCurrent', { name: active.name }) : t('projectSwitcher.select')
  const sections = switcherSections(projects, activeProjectId, recentIds, query)

  const choose = (projectId: string): void => {
    setOpen(false)
    // Switching into a project always lands on its Chat — the project's
    // primary workspace (spec §5).
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const item = (project: ProjectSwitcherProject): React.JSX.Element => {
    const isCurrent = project.id === activeProjectId
    const quiet = project.status === 'paused' || project.status === 'closed'
    return (
      <CommandItem key={project.id} value={project.id} onSelect={() => choose(project.id)} className="gap-2.5">
        <ProjectMark name={project.name} />
        <span className={cn('min-w-0 flex-1 truncate', isCurrent && 'font-medium')}>{project.name}</span>
        {quiet && project.status && (
          <span className="text-muted-foreground shrink-0 text-xs">{tProjects(`card.status.${project.status}`)}</span>
        )}
        {isCurrent && <Check className="size-4 shrink-0" aria-hidden />}
      </CommandItem>
    )
  }

  const trigger = (
    <PopoverTrigger className={cn(TRIGGER_CLASS, collapsed && TILE_CLASS)} aria-label={triggerLabel}>
      <ProjectMark
        name={name}
        onBand
        className="group-hover/switcher:bg-muted group-data-[state=open]/switcher:bg-muted"
      />
      {!collapsed && (
        <>
          <span className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium">{name}</span>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
              open && 'rotate-180'
            )}
            aria-hidden
          />
        </>
      )}
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {collapsed ? (
        // The icon rail shows the mark alone, so the name is a tooltip beside
        // it, as the section tiles below name theirs.
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
        className="w-72 p-0 motion-reduce:animate-none"
      >
        {/* The phone's sheet in a popover: a search first (a dozen running
            projects is past what a reader scans), then the three opened last,
            then the rest. One order on both shapes (`project-list.ts`). */}
        <Command shouldFilter={false} loop label={t('projectSwitcher.switchHeading')}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
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
                className="font-medium"
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
