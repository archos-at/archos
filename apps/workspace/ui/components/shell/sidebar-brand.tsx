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

  const home = (
    <Link
      href="/app/projects"
      aria-label={t('allProjects')}
      className={cn(
        'rounded-control outline-none',
        FOCUS_RING_INSET,
        iconRail
          ? // Under the pointer the fold control takes the mark's place (the
            // way back to every project is also the switcher's last row); a
            // finger has no hover, so there the control stands alone.
            'flex size-9 items-center justify-center transition-opacity duration-quick ease-out group-hover/brand:opacity-0 group-has-[[data-slot=rail-fold]:focus-visible]/brand:opacity-0 pointer-coarse:hidden motion-reduce:transition-none'
          : 'text-foreground'
      )}
    >
      <Logo kind={iconRail ? 'icon' : 'wordmark'} size="small" />
    </Link>
  )

  // Both widths keep the fold control in the head's 56px row, so it never
  // changes corner on a fold: expanded at the row's end, in the icon rail in
  // the mark's place while the pointer is on the head (the idiom of the
  // collapsed sidebars people know). The row is the org header's (`brand-slot.ts`),
  // so the wordmark does not move when the overview gives way to a project,
  // and the project tile and the sections below start at the height they start
  // at expanded.
  if (iconRail) {
    return (
      <div className={cn(BRAND_ROW, 'justify-center')}>
        <div className="group/brand relative flex size-9 items-center justify-center">
          {home}
          <RailFoldButton className="absolute inset-0 opacity-0 transition-opacity duration-quick ease-out group-hover/brand:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none" />
        </div>
      </div>
    )
  }
  return (
    <div className={cn(BRAND_ROW, BRAND_INSET_RAIL)}>
      {home}
      {!isMobile && <RailFoldButton className="ml-auto" />}
    </div>
  )
}

/**
 * The control that folds the rail and brings it back. Expanded it ends the
 * brand row (28px, 44px under a finger); in the icon rail it is the head's
 * 36px tile, on the rail's 32px axis.
 */
export function RailFoldButton({ className }: { className?: string }) {
  const t = useTranslations(navCopy)
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  return (
    <button
      type="button"
      data-slot="rail-fold"
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
