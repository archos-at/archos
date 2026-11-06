'use client'

/**
 * The rail's head: the way home to all projects (the wordmark, or the icon on
 * the icon rail) and the control that folds the rail. The wordmark is the
 * `Logo` component, which reads the name from one place (`PRODUCT_NAME`).
 */

import Link from 'next/link'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { useSidebar } from '@/components/ui/sidebar'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { BRAND_INSET_RAIL, BRAND_ROW } from './brand-slot'

export function SidebarBrand({ iconRail }: { iconRail: boolean }) {
  const t = useTranslations(navCopy)
  const { isMobile } = useSidebar()

  return (
    // Icon rail: the mark alone, centred in the same 56px row, so the project
    // tile and the sections below start at the height they start at expanded
    // and nothing jumps vertically on a fold; its fold control stands at the foot
    // (`app-sidebar.tsx`). Expanded: the wordmark in the org header's own row and
    // inset (`brand-slot.ts`), so it does not move when the overview gives way to
    // a project, with the fold control at the row's end.
    <div className={cn(BRAND_ROW, iconRail ? 'justify-center' : BRAND_INSET_RAIL)}>
      <Link
        href="/app/projects"
        aria-label={t('allProjects')}
        className={cn(
          'rounded-control outline-none',
          FOCUS_RING_INSET,
          iconRail
            ? 'flex h-7 items-center justify-center'
            : 'text-foreground'
        )}
      >
        <Logo kind={iconRail ? 'icon' : 'wordmark'} size="small" />
      </Link>
      {!iconRail && !isMobile && <RailFoldButton className="ml-auto" />}
    </div>
  )
}

/**
 * The control that folds the rail and brings it back. Expanded it ends the
 * brand row (28px, 44px under a finger); in the icon rail it is a 36px tile
 * over the person, on the rail's 32px axis.
 */
export function RailFoldButton({ className }: { className?: string }) {
  const t = useTranslations(navCopy)
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
      className={cn(
        'text-muted-foreground hover:text-foreground flex shrink-0 items-center justify-center rounded-control outline-none transition-colors duration-quick ease-out motion-reduce:transition-none',
        FOCUS_RING_INSET,
        collapsed ? 'size-9' : 'size-7 pointer-coarse:size-11',
        className
      )}
    >
      {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
    </button>
  )
}
