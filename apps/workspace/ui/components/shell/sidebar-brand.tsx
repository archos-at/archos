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
      <span className="ml-auto flex items-center gap-0.5">
        <ShellSearchButton className="size-7 [&_svg]:size-4" />
        {!isMobile && <RailFoldButton />}
      </span>
    </div>
  )
}

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
      <PanelLeft className="size-4" aria-hidden />
    </button>
  )
}
