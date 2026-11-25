'use client'

import type { JSX, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronsUpDown } from 'lucide-react'

import { AnimatePresence, motion, motionQuick, motionSnap, useMotionToken } from '@/components/motion'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { PRESSABLE } from '@/components/ui/press'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { cn } from '@/lib/utils'
import type { ProjectSwitcherProject } from './project-list'
import { PERSONAL_CHAT_PATH, type RailMode } from './rail-mode'
import { RailModeSwitch } from './rail-mode-switch'
import { shownSide, useRailSide } from './rail-side'
import { useShellOverlays } from './shell-overlays'

const PROJECT_PRESS_SLIDE_PX = 10

export function onSideChat(pathname: string, projectId: string | null, onSide: boolean): boolean {
  const chatPath = projectId === null ? PERSONAL_CHAT_PATH : `/app/projects/${projectId}/chat`
  return onSide && (pathname === chatPath || pathname.startsWith(`${chatPath}/`))
}

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
  const enter = useMotionToken(motionQuick)
  const leave = useMotionToken(motionSnap)
  const shownName = mode === 'project' ? projectName : null
  return (
    <div
      data-slot="phone-side-bar"
      className="flex h-14 items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
    >
      <div className="w-52 shrink-0">
        <RailModeSwitch mode={mode} collapsed={false} navigate={navigateSide} tourAnchor={TOUR_ANCHORS.sidesPhone} />
      </div>
      <AnimatePresence initial={false}>
        {shownName && (
          <motion.div
            key="project"
            data-slot="phone-side-project"
            className="flex min-w-0 flex-1"
            initial={{ opacity: 0, x: PROJECT_PRESS_SLIDE_PX }}
            animate={{ opacity: 1, x: 0, transition: enter }}
            exit={{ opacity: 0, x: PROJECT_PRESS_SLIDE_PX, transition: leave }}
          >
            <button
              type="button"
              data-project-selector=""
              onClick={() => openMore(true, 'projects')}
              aria-label={t('projectSwitcher.switchCurrent', { name: shownName })}
              title={shownName}
              className={cn(
                'bg-sheet shadow-press active:bg-pressed dark:bg-transparent text-foreground flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-control pl-3 pr-2 text-[13px] font-medium outline-none',
                PRESSABLE,
                FOCUS_RING
              )}
            >
              <MiddleTruncate text={shownName} tail={8} className="min-w-0 flex-1 text-left" />
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export interface PhoneChatSideRowProps {
  projectId: string | null
  onSide: boolean
  projects: readonly ProjectSwitcherProject[]
  pathname?: string
  navigateSide?: (href: string) => void
}

export function PhoneChatSideRow({
  projectId,
  onSide,
  projects,
  pathname: pathnameOverride,
  navigateSide,
}: PhoneChatSideRowProps): JSX.Element | null {
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const pending = useRailSide((state) => state.pending)
  if (!onSideChat(pathname, projectId, onSide)) return null
  const side = shownSide(pending, { mode: projectId === null ? 'personal' : 'project', projectId })!
  return (
    <div data-slot="phone-chat-side-row" className="shrink-0 md:hidden">
      <PhoneSideBar mode={side.mode} projectId={side.projectId} projects={projects} navigateSide={navigateSide} />
    </div>
  )
}

const ShellSideRowContext = createContext<PhoneChatSideRowProps | null>(null)

export function ShellSideRowProvider({ value, children }: { value: PhoneChatSideRowProps; children: ReactNode }): JSX.Element {
  return <ShellSideRowContext.Provider value={value}>{children}</ShellSideRowContext.Provider>
}

export function PhoneChatSideRowSlot(): JSX.Element | null {
  const row = useContext(ShellSideRowContext)
  return row ? <PhoneChatSideRow {...row} /> : null
}
