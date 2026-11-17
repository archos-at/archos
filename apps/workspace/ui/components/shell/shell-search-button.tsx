'use client'

import type { JSX } from 'react'
import { Search } from 'lucide-react'

import { FOCUS_RING } from '@/components/ui/focus-ring'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { useShellOverlays } from './shell-overlays'

export function ShellSearchButton({ className }: { className?: string }): JSX.Element {
  const t = useTranslations(navCopy)
  const open = useShellOverlays((s) => s.paletteOpen)
  const setOpen = useShellOverlays((s) => s.setPaletteOpen)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('search.open')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="Control+K Meta+K"
      data-testid="shell-search"
      data-tour={TOUR_ANCHORS.search}
      className={cn(
        'text-muted-foreground hover:bg-hover hover:text-foreground duration-quick pointer-coarse:size-11 relative flex size-9 shrink-0 items-center justify-center rounded-control outline-none transition-colors ease-out motion-reduce:transition-none',
        FOCUS_RING,
        className
      )}
    >
      <Search className="size-[1.125rem]" aria-hidden />
    </button>
  )
}
