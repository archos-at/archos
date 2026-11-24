'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, LayoutGrid, Plus, Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { projectInitials, switchableProjects, type ProjectSwitcherProject } from './project-list'
import { NEW_PROJECT_PATH, PROJECT_OVERVIEW_PATH } from './landing'

export type { ProjectSwitcherProject } from './project-list'

export interface ProjectSwitcherProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  collapsed?: boolean
}

const TRIGGER_CLASS = 'h-10 w-full justify-between gap-1 pr-1.5 pl-3 text-left pointer-coarse:h-11'

const TILE_CLASS = 'size-9 min-w-0 p-0 pointer-coarse:size-11'

const GROUP_CLASS =
  'p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground'

const projectSettingsHref = (projectId: string): string => `/app/projects/${projectId}/settings`

export function ProjectSwitcher({ projects, activeProjectId, collapsed }: ProjectSwitcherProps) {
  const router = useRouter()
  const t = useTranslations(navCopy)
  const tProjects = useTranslations(projectsCopy)
  const active = projects.find((p) => p.id === activeProjectId)
  const offered = switchableProjects(projects, activeProjectId)
  const [open, setOpen] = React.useState(false)
  const [cursor, setCursor] = React.useState('')
  const commandRef = React.useRef<HTMLDivElement>(null)

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) setCursor(activeProjectId ?? offered[0]?.id ?? '')
  }

  const name = active?.name ?? t('projectSwitcher.select')
  const triggerLabel = active ? t('projectSwitcher.switchCurrent', { name: active.name }) : t('projectSwitcher.select')

  const choose = (projectId: string): void => {
    setOpen(false)
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const go = (href: string): void => {
    setOpen(false)
    router.push(href)
  }
  const item = (project: ProjectSwitcherProject): React.JSX.Element => {
    const isCurrent = project.id === activeProjectId
    const quiet = project.status === 'paused' || project.status === 'closed'
    return (
      <CommandItem
        key={project.id}
        value={project.id}
        onSelect={() => choose(project.id)}
        className={cn('h-9 gap-1.5 pr-1 pointer-coarse:h-11', isCurrent && 'bg-desk data-[selected=true]:bg-desk')}
        data-current={isCurrent ? '' : undefined}
      >
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {quiet && project.status && (
          <span className="text-muted-foreground shrink-0 text-xs">{tProjects(`card.status.${project.status}`)}</span>
        )}
        {isCurrent && <Check className="size-4 shrink-0" aria-hidden />}
        {isCurrent && (
          <Button asChild variant="secondary" size="icon" className="text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-11">
            <Link
              href={projectSettingsHref(project.id)}
              aria-label={t('projectSwitcher.projectSettings', { name: project.name })}
              title={t('projectSwitcher.projectSettingsTitle')}
              data-testid="project-switcher-settings"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
              }}
            >
              <Settings className="size-3.5" aria-hidden />
            </Link>
          </Button>
        )}
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
        className="w-80 max-w-[calc(100vw-2rem)] p-1.5 motion-reduce:animate-none"
        data-testid="project-switcher-menu"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          commandRef.current?.focus()
        }}
      >
        {/* As the concept draws it: one list of the projects, the current one marked with its settings at hand, and
            under a rule the two ways out. The search lives in the overview, which holds every project. */}
        <Command ref={commandRef} tabIndex={-1} loop value={cursor} onValueChange={setCursor} label={t('projectSwitcher.switchHeading')} className="rounded-surface bg-transparent [&_[cmdk-item]]:text-[13px]">
          <CommandList className="max-h-[min(24rem,60dvh)] p-0">
            <CommandGroup heading={t('projectSwitcher.projects')} className={GROUP_CLASS}>
              {offered.map(item)}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="bg-desk mx-1 my-1.5 h-px" aria-hidden />
        <div className="grid grid-cols-2 gap-1.5 p-1">
          <Button type="button" variant="secondary" size="sm" onClick={() => go(PROJECT_OVERVIEW_PATH)} data-testid="project-switcher-overview">
            <LayoutGrid className="size-3.5" aria-hidden />
            {t('projectSwitcher.overview')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => go(NEW_PROJECT_PATH)} data-testid="project-switcher-new">
            <Plus className="size-3.5" aria-hidden />
            {t('projectSwitcher.newProject')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
