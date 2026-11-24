'use client'

import Link from 'next/link'
import { PanelLeft } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
import { useSidebar } from '@/components/ui/sidebar'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { BRAND_INSET_RAIL, BRAND_ROW } from './brand-slot'
import { ShellSearchButton } from './shell-search-button'

export function SidebarBrand({ iconRail }: { iconRail: boolean }) {
  const t = useTranslations(navCopy)
  const { isMobile } = useSidebar()

  const home = (
    <Link
      href="/app"
      aria-label={t('allProjects')}
      data-focus-inset=""
      className="text-foreground rounded-control"
    >
      <Logo kind="wordmark" size="small" />
    </Link>
  )

  if (iconRail) {
    return (
      <div className={cn(BRAND_ROW, 'justify-center')}>
        <RailFoldButton />
      </div>
    )
  }
  return (
    <div className={cn(BRAND_ROW, BRAND_INSET_RAIL)}>
      {home}
      {!isMobile && (
        <div className="ml-auto flex items-center gap-0.5">
          <ShellSearchButton className="size-7" />
          <RailFoldButton />
        </div>
      )}
    </div>
  )
}

export function RailFoldButton({ className }: { className?: string }) {
  const t = useTranslations(navCopy)
  const { state, peek, toggleSidebar } = useSidebar()
  const folded = state === 'collapsed'
  return (
    <button
      type="button"
      data-slot="rail-fold"
      data-focus-inset=""
      onClick={toggleSidebar}
      aria-label={folded ? (peek ? t('pinSidebar') : t('expandSidebar')) : t('collapseSidebar')}
      aria-expanded={!folded}
      className={cn(
        'text-muted-foreground hover:bg-selected hover:text-foreground flex shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:size-11',
        folded && !peek ? 'size-9' : 'size-7',
        className
      )}
    >
      <PanelLeft className="size-[1.125rem]" aria-hidden />
    </button>
  )
}
