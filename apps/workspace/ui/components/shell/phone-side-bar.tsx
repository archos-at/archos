'use client'

import type { JSX } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { PRESSABLE } from '@/components/ui/press'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { cn } from '@/lib/utils'
import type { ProjectSwitcherProject } from './project-list'
import type { RailMode } from './rail-mode'
import { RailModeSwitch } from './rail-mode-switch'
import { useShellOverlays } from './shell-overlays'

export function PhoneSideBar({
  mode,
  projectId,
  projects,
  navigateSide,
}: {
  mode: RailMode
  projectId: string | null
  projects: readonly ProjectSwitcherProject[]
  navigateSide?: (href: string) => void
}): JSX.Element {
  const t = useTranslations(navCopy)
  const projectName = projects.find((project) => project.id === projectId)?.name ?? null
  const openMore = useShellOverlays((s) => s.setMoreSheetOpen)
  return (
    <div
      data-slot="phone-side-bar"
      className="flex h-14 items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
    >
      <div className="w-52 shrink-0">
        <RailModeSwitch mode={mode} collapsed={false} navigate={navigateSide} tourAnchor={TOUR_ANCHORS.sidesPhone} />
      </div>
      {mode === 'project' && projectName && (
        <button
          type="button"
          data-project-selector=""
          onClick={() => openMore(true, 'projects')}
          aria-label={t('projectSwitcher.switchCurrent', { name: projectName })}
          title={projectName}
          className={cn(
            'bg-sheet shadow-press active:bg-pressed dark:bg-transparent text-foreground flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-control pl-3 pr-2 text-[13px] font-medium outline-none',
            PRESSABLE,
            FOCUS_RING
          )}
        >
          <MiddleTruncate text={projectName} tail={8} className="min-w-0 flex-1 text-left" />
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </button>
      )}
    </div>
  )
}
