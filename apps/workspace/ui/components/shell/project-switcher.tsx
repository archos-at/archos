'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Settings } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLayoutStore } from '@/features/layout/store'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { projectsCopy } from '@/i18n/namespaces/projects'
import type { ProjectStatus } from '@/lib/projects/project-status'
import { cn } from '@/lib/utils'
import { useShellOverlays } from './shell-overlays'

export interface ProjectSwitcherProject {
  id: string
  name: string
  /** Absent reads as active. */
  status?: ProjectStatus
}

/**
 * The projects the switcher offers: where one works. Every member reads every
 * closed project (ADR-0090), so listing them would bury the dozen running ones
 * under everything the office ever finished; a closed project is reached from
 * the projects list, and stays here only while it is the one open (ADR-0098).
 */
export function switchableProjects(projects: readonly ProjectSwitcherProject[], currentId?: string): ProjectSwitcherProject[] {
  return projects.filter((project) => project.status !== 'closed' || project.id === currentId)
}

export interface ProjectSwitcherProps {
  projects: ProjectSwitcherProject[]
  activeProjectId?: string
  collapsed?: boolean
}

/**
 * A small dashed ring with a dot — the project's glyph, from the click dummy.
 * In ink for the project one is in, quiet ink for the others. It was green
 * (`--status-active`) for the current project, which made the always-on
 * marker a status colour that said nothing: green means a project is Aktiv,
 * and the current one is green whatever its status. Colour is for attention
 * and error, and the check mark and the weight say which one is current.
 */
export function ProjectStatusDot({ active }: { active?: boolean }) {
  const color = active ? 'var(--foreground)' : 'var(--muted-foreground)'
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-dashed"
      style={{ borderColor: color }}
      aria-hidden
    >
      <span className="size-[5px] rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

/**
 * The switcher is the heading of the project's sections, so it is set as one:
 * no box, the name in ink at 14px on the nav's own columns (the glyph in the
 * icons' 16px slot at 24px, the name on the labels' edge), a fill only while
 * it is hovered or open. It was a white card with a hairline and a shadow, the
 * one raised box on the rail, competing with the active section beneath it.
 */
const TRIGGER_CLASS = cn(
  'flex h-9 w-full items-center gap-[11px] rounded-control px-3 text-left pointer-coarse:h-11',
  'transition-[color,background-color,transform] duration-quick ease-out',
  // Open is the state fill, as hover: white is the selected section's alone.
  'hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent active:scale-[0.98] motion-reduce:transition-none',
  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
)

/** The icon rail's tile: a nav tile's 36px square on the rail's 32px axis. */
const TILE_CLASS = 'size-9 justify-center px-0 pointer-coarse:size-9'

export function ProjectSwitcher({ projects, activeProjectId, collapsed }: ProjectSwitcherProps) {
  const router = useRouter()
  const t = useTranslations(navCopy)
  const tProjects = useTranslations(projectsCopy)
  const active = projects.find((p) => p.id === activeProjectId)
  const offered = switchableProjects(projects, activeProjectId)
  const [open, setOpen] = React.useState(false)
  const isMobile = useIsMobile()
  const setDrawerOpen = useLayoutStore((s) => s.setMobileNavOpen)
  const setSheetOpen = useShellOverlays((s) => s.setProjectSheetOpen)

  const triggerLabel = active
    ? t('projectSwitcher.switchCurrent', { name: active.name })
    : t('projectSwitcher.select')
  const triggerBody = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ProjectStatusDot active={Boolean(active)} />
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {active?.name ?? t('projectSwitcher.select')}
          </span>
          <span
            className={cn(
              'flex size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
              open && 'rotate-180',
            )}
            aria-hidden
          >
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </span>
        </>
      )}
    </>
  )

  // In the phone drawer the switcher is the sheet, not a dropdown: a 240px
  // menu of 32px rows hanging off the top of a drawer is the stretch the sheet
  // exists to remove. The drawer steps aside so one overlay stands at a time.
  if (isMobile) {
    return (
      <button
        type="button"
        className={cn(TRIGGER_CLASS, collapsed && TILE_CLASS)}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        onClick={() => {
          setDrawerOpen(false)
          setSheetOpen(true)
        }}
      >
        {triggerBody}
      </button>
    )
  }

  const trigger = (
    <DropdownMenuTrigger className={cn(TRIGGER_CLASS, collapsed && TILE_CLASS)} aria-label={triggerLabel}>
      {triggerBody}
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu onOpenChange={setOpen}>
      {collapsed ? (
        // The icon rail shows the glyph alone, so the name is a tooltip beside
        // it, as the section tiles below name theirs.
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{active?.name ?? t('projectSwitcher.select')}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        align="start"
        side={collapsed ? 'right' : 'bottom'}
        // 288px: at 240 a project's name kept a dozen characters beside its
        // status and its settings.
        className="w-72 motion-reduce:animate-none"
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t('projectSwitcher.switchHeading')}
        </DropdownMenuLabel>
        {offered.map((project) => {
          const isCurrent = project.id === activeProjectId
          const quiet = project.status === 'paused' || project.status === 'closed'
          return (
            <DropdownMenuItem
              key={project.id}
              // Switching into a project always lands on its Chat — the
              // project's primary workspace (spec §5).
              onSelect={() => router.push(`/app/projects/${project.id}/chat`)}
              className="group/project gap-2.5 pr-1.5"
            >
              <ProjectStatusDot active={isCurrent} />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px] text-foreground',
                  isCurrent && 'font-medium',
                )}
              >
                {project.name}
              </span>
              {quiet && project.status && (
                <span className="text-muted-foreground shrink-0 text-xs">{tProjects(`card.status.${project.status}`)}</span>
              )}
              {isCurrent && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
              <button
                type="button"
                aria-label={t('projectSwitcher.projectSettings', { name: project.name })}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  router.push(`/app/projects/${project.id}/settings`)
                }}
                // ≥44px touch target (a11y) via padding, with the icon kept
                // small; negative margin keeps the row from growing.
                // On the row under the pointer or the keyboard, and always under
                // a finger: six gears down the list were six times the same
                // word, read before any project's name.
                className="-my-2 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-control text-muted-foreground opacity-0 group-data-[highlighted]/project:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 transition-[color,background-color,scale,opacity] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-snap),var(--motion-quick)] ease-out hover:bg-accent hover:text-foreground active:scale-[0.98] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                <Settings className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => router.push('/app/projects')}
          className="text-[13px] font-medium text-foreground"
        >
          {t('projectSwitcher.viewAllProjects')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
