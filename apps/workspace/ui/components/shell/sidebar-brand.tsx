'use client'

/**
 * The rail's head: the way home to all projects (the wordmark, or the icon on
 * the icon rail) and the control that folds the rail. The wordmark is the
 * `Logo` component, which reads the name from one place (`PRODUCT_NAME`).
 */

import Link from 'next/link'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
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
      data-focus-inset=""
      className={cn(
        'rounded-control',
        iconRail ? 'flex size-9 items-center justify-center' : 'text-foreground'
      )}
    >
      <Logo kind={iconRail ? 'icon' : 'wordmark'} size="small" />
    </Link>
  )

  // Both widths keep the fold control in the head, in view, so it never changes
  // corner on a fold: expanded at the end of the brand row, in the icon rail
  // under the mark. It jumped to the foot in one round and hid behind a hover
  // in the next; the way out of a mode is visible where it was used. The row is
  // the org header's (`brand-slot.ts`), so the wordmark does not move when the
  // overview gives way to a project.
  if (iconRail) {
    return (
      <div className="flex flex-col items-center">
        <div className={cn(BRAND_ROW, 'justify-center')}>{home}</div>
        <RailFoldButton />
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
 * brand row (28px, 44px under a finger); in the icon rail it is a 36px tile
 * under the mark, on the rail's 32px axis.
 */
export function RailFoldButton({ className }: { className?: string }) {
  const t = useTranslations(navCopy)
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'
  return (
    <button
      type="button"
      data-slot="rail-fold"
      data-focus-inset=""
      onClick={toggleSidebar}
      aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
      className={cn(
        'text-muted-foreground hover:text-foreground flex shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out motion-reduce:transition-none',
        collapsed ? 'size-9' : 'size-7 pointer-coarse:size-11',
        className
      )}
    >
      {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
    </button>
  )
}
