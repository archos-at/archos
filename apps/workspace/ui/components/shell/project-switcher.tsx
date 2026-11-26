'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronsUpDown, LayoutGrid, Plus, Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import { projectInitials, switcherSections, type ProjectSwitcherProject } from './project-list'
import { readRecentProjectIds } from './recent-projects'
import { NEW_PROJECT_PATH, PROJECT_OVERVIEW_PATH } from './landing'
import { openOverviewFor } from './project-overview-entry'

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
  const [open, setOpen] = React.useState(false)
  const [cursor, setCursor] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const [recentIds, setRecentIds] = React.useState<string[]>([])
  const inputRef = React.useRef<HTMLInputElement>(null)
  const commandRef = React.useRef<HTMLDivElement>(null)
  const sections = switcherSections(projects, activeProjectId, recentIds, query)
  const listed =
    sections.kind === 'search' ? sections.matches : expanded ? sections.all : sections.shortlist

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next) return
    const recent = readRecentProjectIds()
    setRecentIds(recent)
    setQuery('')
    setExpanded(false)
    releaseCursor()
    const opened = switcherSections(projects, activeProjectId, recent, '')
    setCursor(
      activeProjectId ?? (opened.kind === 'browse' ? opened.shortlist[0]?.id : undefined) ?? ''
    )
  }
  const onQueryChange = (next: string): void => {
    releaseCursor()
    setQuery(next)
    const found = switcherSections(projects, activeProjectId, recentIds, next)
    const first = found.kind === 'search' ? found.matches[0] : found.shortlist[0]
    setCursor((found.kind === 'browse' && activeProjectId) || first?.id || '')
  }
  // cmdk sends the cursor to the top when the row under it unmounts; it stays on the first unfolded project until
  // the person moves it.
  const heldCursor = React.useRef<string | null>(null)
  const showAll = (): void => {
    if (sections.kind !== 'browse') return
    heldCursor.current = sections.rest[0]?.id ?? null
    setExpanded(true)
  }
  const onCursorChange = (next: string): void => setCursor(heldCursor.current ?? next)
  const releaseCursor = (): void => {
    heldCursor.current = null
  }

  const name = active?.name ?? t('projectSwitcher.select')
  const triggerLabel = active
    ? t('projectSwitcher.switchCurrent', { name: active.name })
    : t('projectSwitcher.select')

  const choose = (projectId: string): void => {
    setOpen(false)
    if (projectId !== activeProjectId) router.push(`/app/projects/${projectId}/chat`)
  }
  const go = (href: string): void => {
    setOpen(false)
    if (!openOverviewFor(href)) router.push(href)
  }
  const item = (project: ProjectSwitcherProject): React.JSX.Element => {
    const isCurrent = project.id === activeProjectId
    const quiet = project.status === 'paused' || project.status === 'closed'
    return (
      <CommandItem
        key={project.id}
        value={project.id}
        onSelect={() => choose(project.id)}
        aria-label={
          quiet && project.status
            ? `${project.name}, ${tProjects(`card.status.${project.status}`)}`
            : project.name
        }
        className={cn(
          'group h-9 gap-1.5 rounded-control pr-1 pointer-coarse:h-11',
          isCurrent && 'bg-desk data-[selected=true]:bg-desk'
        )}
        data-current={isCurrent ? '' : undefined}
      >
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {quiet && project.status && (
          <span className="text-muted-foreground shrink-0 text-xs group-hover:hidden group-data-[selected=true]:hidden pointer-coarse:inline">
            {tProjects(`card.status.${project.status}`)}
          </span>
        )}
        {isCurrent && <Check className="size-4 shrink-0" aria-hidden />}
        <Button
          asChild
          variant="secondary"
          size="icon"
          className={cn(
            'text-muted-foreground hover:text-foreground size-7 shrink-0 pointer-coarse:size-11',
            !isCurrent &&
              'hidden group-hover:inline-flex group-data-[selected=true]:inline-flex pointer-coarse:inline-flex'
          )}
        >
          <Link
            href={projectSettingsHref(project.id)}
            aria-label={t('projectSwitcher.projectSettings', { name: project.name })}
            title={t('projectSwitcher.projectSettingsTitle')}
            data-testid="project-switcher-settings"
            tabIndex={isCurrent ? undefined : -1}
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
          <span
            aria-hidden
            data-slot="project-initials"
            className="text-xs leading-none font-semibold"
          >
            {projectInitials(name)}
          </span>
        ) : (
          <>
            <MiddleTruncate
              text={name}
              tail={12}
              className="min-w-0 flex-1 text-[13px] font-medium"
            />
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
        className="w-80 max-w-[calc(100vw-2rem)] rounded-surface p-1 motion-reduce:animate-none"
        data-testid="project-switcher-menu"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          // A touch screen would raise its keyboard over the list on every open.
          if (window.matchMedia?.('(pointer: fine)').matches === false) commandRef.current?.focus()
          else inputRef.current?.focus()
        }}
      >
        {/* The five projects last worked in, the current one always among them; the rest one row further, and the
            search over every project. Under a rule the two ways out. */}
        <Command
          ref={commandRef}
          tabIndex={-1}
          shouldFilter={false}
          loop
          value={cursor}
          onValueChange={onCursorChange}
          onKeyDownCapture={releaseCursor}
          onPointerMoveCapture={releaseCursor}
          label={t('projectSwitcher.switchHeading')}
          className="rounded-control bg-transparent [&_[cmdk-input-wrapper]]:h-9 [&_[cmdk-input-wrapper]]:px-2 pointer-coarse:[&_[cmdk-input-wrapper]]:h-11 [&_[cmdk-item]]:text-[13px]"
        >
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={onQueryChange}
            placeholder={t('projectSheet.searchPlaceholder')}
            aria-label={t('projectSheet.searchLabel')}
            className="h-9 py-2 text-[13px] pointer-coarse:h-11"
            data-testid="project-switcher-search"
          />
          <CommandList className="max-h-[min(24rem,60dvh)] p-0">
            {listed.length === 0 && sections.kind === 'search' ? (
              <p
                className="text-muted-foreground px-3 py-6 text-center text-[13px]"
                data-testid="project-switcher-no-match"
              >
                {t('projectSheet.noMatch')}
              </p>
            ) : (
              <CommandGroup
                heading={t(
                  sections.kind === 'search' ? 'projectSheet.matches' : 'projectSwitcher.projects'
                )}
                className={GROUP_CLASS}
              >
                {listed.map(item)}
                {sections.kind === 'browse' && !expanded && sections.rest.length > 0 && (
                  <ShowAllRow
                    hidden={sections.rest.length}
                    label={t('projectSwitcher.showAll')}
                    onSelect={showAll}
                  />
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="bg-desk mx-1 my-1.5 h-px" aria-hidden />
        <div className="grid grid-cols-2 gap-1.5 p-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => go(PROJECT_OVERVIEW_PATH)}
            data-testid="project-switcher-overview"
          >
            <LayoutGrid className="size-3.5" aria-hidden />
            {t('projectSwitcher.overview')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => go(NEW_PROJECT_PATH)}
            data-testid="project-switcher-new"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('projectSwitcher.newProject')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ShowAllRow({
  hidden,
  label,
  onSelect,
}: {
  hidden: number
  label: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <CommandItem
      value="project-switcher-show-all"
      onSelect={onSelect}
      className={cn('h-9 gap-1.5 rounded-control pr-2 pointer-coarse:h-11', 'text-muted-foreground')}
      data-testid="project-switcher-show-all"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums">{hidden}</span>
      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
    </CommandItem>
  )
}
