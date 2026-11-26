'use client'

import type { JSX, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import { ChevronLeft, Menu, SquarePen } from 'lucide-react'

import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { PRESSABLE } from '@/components/ui/press'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { TOUR_ANCHORS } from '@/lib/onboarding/product-tour'
import { cn } from '@/lib/utils'
import { ConnectionBand } from './connection-band'
import { useShellOverlays } from './shell-overlays'
import { ShellSearchButton } from './shell-search-button'

export const PHONE_FLOAT_BUTTON = cn(
  'bg-sheet text-foreground shadow-press active:bg-pressed relative flex size-11 shrink-0 items-center justify-center rounded-full outline-none',
  PRESSABLE,
  FOCUS_RING
)

export interface PhoneFloatingBarProps {
  onChat: boolean
  newChatHref: string
  back: { href: string; label: string } | null
  /** What waits behind the menu (the Postfach, news from the product team), drawn on the button. */
  menuMark?: ReactNode
}

export function PhoneFloatingBar({
  onChat,
  newChatHref,
  back,
  menuMark,
}: PhoneFloatingBarProps): JSX.Element {
  const t = useTranslations(navCopy)
  const menuOpen = useShellOverlays((s) => s.menuOpen)
  const setMenuOpen = useShellOverlays((s) => s.setMenuOpen)

  return (
    <div
      data-slot="phone-floating-bar"
      data-on-chat={onChat || undefined}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 md:hidden"
    >
      {/* The chat's header is its own paper; elsewhere the page scrolls under the buttons. */}
      {!onChat && (
        <div
          aria-hidden
          data-slot="phone-floating-scrim"
          className="from-background absolute inset-x-0 top-0 h-[calc(var(--phone-top-room)+0.75rem)] bg-gradient-to-b from-60% to-transparent"
        />
      )}
      <div className="relative flex items-center gap-2 pt-[calc(max(0.5rem,env(safe-area-inset-top))+0.125rem)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t('phoneMenu.open')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          data-testid="phone-menu-button"
          data-tour={TOUR_ANCHORS.menu}
          data-tour-placement="below"
          className={cn(PHONE_FLOAT_BUTTON, 'pointer-events-auto')}
        >
          <Menu className="size-5" aria-hidden />
          {menuMark}
        </button>
        {back && (
          <Link
            href={back.href}
            aria-label={back.label}
            data-testid="phone-back"
            className={cn(PHONE_FLOAT_BUTTON, 'pointer-events-auto')}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
        )}
        <div className="flex min-w-0 flex-1">{!onChat && <PhonePlaceOfShell />}</div>
        <div className="flex items-center gap-2">
          {onChat ? (
            <Link
              href={newChatHref}
              aria-label={t('newChat')}
              data-testid="phone-new-chat"
              className={cn(PHONE_FLOAT_BUTTON, 'pointer-events-auto')}
            >
              <SquarePen className="size-[1.125rem]" aria-hidden />
            </Link>
          ) : (
            <ShellSearchButton
              className={cn(
                PHONE_FLOAT_BUTTON,
                'text-foreground pointer-events-auto pointer-coarse:size-11'
              )}
            />
          )}
        </div>
      </div>
      {!onChat && <PhoneConnection />}
    </div>
  )
}

const PhonePlaceContext = createContext<string | null>(null)

export const PhonePlaceProvider = PhonePlaceContext.Provider

export function PhonePlaceOfShell({ className }: { className?: string }): JSX.Element | null {
  const name = useContext(PhonePlaceContext)
  return name ? <PhonePlacePill name={name} className={className} /> : null
}

export function PhonePlacePill({
  name,
  className,
}: {
  name: string
  className?: string
}): JSX.Element {
  const t = useTranslations(navCopy)
  const setMenuOpen = useShellOverlays((s) => s.setMenuOpen)
  return (
    <button
      type="button"
      onClick={() => setMenuOpen(true)}
      aria-label={t('phoneMenu.place', { place: name })}
      data-testid="phone-place"
      title={name}
      className={cn(
        PHONE_FLOAT_BUTTON,
        'pointer-events-auto h-11 w-auto max-w-[min(15rem,100%)] min-w-0 px-4 text-sm font-medium',
        className
      )}
    >
      <MiddleTruncate text={name} tail={8} className="min-w-0" />
    </button>
  )
}

function PhoneConnection(): ReactNode {
  return (
    <div className="pointer-events-auto mx-auto mt-1 w-fit px-3">
      <ConnectionBand />
    </div>
  )
}
