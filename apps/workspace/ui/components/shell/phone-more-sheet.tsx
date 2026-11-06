'use client'

/**
 * „Mehr" on a phone: a bottom sheet with the destinations the tab bar does not
 * carry, and the account.
 *
 * It used to open the whole rail as a drawer, which repeated the bar's own four
 * tabs and made the tab feel pointless. What is listed is `moreDestinations`
 * (derived from the bar's tab list and the rail's gates, never a second list).
 * Rows are 56px, the current page is marked, and the actions that were behind
 * the avatar (appearance, language, tour, feedback, sign out) sit below the
 * destinations. The project switcher stays on the header pill.
 */

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Check, ChevronRight, Compass, Globe, LogOut, MessagesSquare, Monitor, Moon, Sun } from 'lucide-react'

import { useAuth } from '@/adapters/auth/use-auth'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { SectionLabel } from '@/components/ui/section-label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useLayoutStore } from '@/features/layout/store'
import type { ThemeMode } from '@/features/layout/types'
import { useStartProductTour } from '@/features/onboarding/components/product-tour'
import {
  useFeedbackAvailable,
  useFeedbackUpdatedCount,
  useOpenFeedbackThreads,
} from '@/features/product-feedback/components'
import { CountPill } from '@/components/ui/count-pill'
import { locales, useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { commonCopy } from '@/i18n/namespaces/common'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { isCurrentDestination, moreDestinations, type MoreDestination, type MoreFlags } from './phone-more'
import { useShellOverlays } from './shell-overlays'
import type { SidebarUser } from './sidebar-user-menu'

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

const ROW =
  'flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm outline-none active:bg-accent ' +
  PRESSABLE +
  ' ' +
  FOCUS_RING_INSET

export interface PhoneMoreSheetProps extends MoreFlags {
  /** The project the bar is for, or null above a project. */
  projectId: string | null
  authRequired: boolean
  /** The route to mark current; the product omits it and the sheet reads the URL. */
  pathname?: string
  /** Heads the organisation's places, as it heads them in the rail; „Organisation" without it. */
  organizationName?: string | null
  /** Heads the project's places, as the switcher heads them in the rail; „Projekt" without it. */
  projectName?: string | null
  /** Who is signed in, shown first under „Konto". */
  user?: SidebarUser
}

function initials(user: SidebarUser): string {
  const source = (user.name || user.email || '').trim()
  return (
    source
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toLocaleUpperCase('de') || '?'
  )
}

export function PhoneMoreSheet({
  projectId,
  authRequired,
  pathname: pinnedPathname,
  organizationName = null,
  projectName = null,
  user,
  ...flags
}: PhoneMoreSheetProps): JSX.Element {
  const t = useTranslations(navCopy)
  const tc = useTranslations(commonCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const tFeedback = useTranslations(feedbackCopy)
  const currentPathname = usePathname() ?? ''
  const pathname = pinnedPathname ?? currentPathname
  const open = useShellOverlays((s) => s.moreSheetOpen)
  const setOpen = useShellOverlays((s) => s.setMoreSheetOpen)
  const { signOut } = useAuth()
  const theme = useLayoutStore((s) => s.theme)
  const ActiveThemeIcon = THEME_ICONS[theme]
  const setTheme = useLayoutStore((s) => s.setTheme)
  const { locale, setLocale, localeNames } = useLocale()
  const startTour = useStartProductTour()
  const openFeedbackThreads = useOpenFeedbackThreads()
  const feedbackUpdatedCount = useFeedbackUpdatedCount()
  const feedbackAvailable = useFeedbackAvailable()

  // A navigation closes the sheet, as it does the project sheet.
  React.useEffect(() => {
    setOpen(false)
  }, [pathname, setOpen])

  const destinations = moreDestinations(projectId, pathname, flags)
  const label = (destination: MoreDestination): string =>
    destination.label.namespace === 'collaboration'
      ? tCollaboration(destination.label.key)
      : t(destination.label.key)
  const projectPlaces = destinations.filter((destination) => destination.group === 'project')
  const orgPlaces = destinations.filter((destination) => destination.group === 'organization')
  const account = destinations.filter((destination) => destination.group === 'account')
  const help = destinations.filter((destination) => destination.group === 'help')
  const row = (destination: MoreDestination): JSX.Element => (
    <DestinationRow
      key={destination.key}
      destination={destination}
      label={label(destination)}
      current={isCurrentDestination(destination, pathname)}
      onNavigate={() => setOpen(false)}
    />
  )
  const act = (run: () => void) => (): void => {
    setOpen(false)
    run()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        closeLabel={t('tabBar.moreSheet.close')}
        data-slot="phone-more-sheet"
        className={cn(
          'max-h-[85dvh] gap-0 overflow-hidden rounded-overlay p-0 outline-none',
          'pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]'
        )}
      >
        <div aria-hidden className="bg-border mx-auto mt-2 h-1 w-9 shrink-0 rounded-full" />
        <SheetHeader className="shrink-0 gap-0.5 px-4 pb-2 pt-3">
          <SheetTitle className="text-base font-medium">{t('tabBar.moreSheet.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('tabBar.moreSheet.description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
          {/* The project's places, then the organisation's under its name,
              as the rail groups them. */}
          {[
            { key: 'project', label: projectName ?? t('tabBar.moreSheet.project'), list: projectPlaces },
            { key: 'organization', label: organizationName ?? t('sectionGroups.org'), list: orgPlaces },
          ].map(({ key, label: groupLabel, list }) =>
            list.length > 0 ? (
              <Group key={key} label={groupLabel}>
                {list.map(row)}
              </Group>
            ) : null
          )}
          <Group label={t('tabBar.moreSheet.account')}>
            {/* Who is signed in, first, as the avatar menu's header says it. */}
            {user && (
              <li className="flex min-h-14 items-center gap-3 px-4">
                <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {initials(user)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-foreground truncate text-[15px] font-medium">{user.name || user.email}</span>
                  {user.name && user.email && <span className="text-muted-foreground truncate text-xs">{user.email}</span>}
                </span>
              </li>
            )}
            {account.map(row)}
            <li className="flex min-h-14 items-center gap-3 px-4">
              <ActiveThemeIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">{tc('theme.label')}</span>
              <Segmented
                ariaLabel={tc('theme.label')}
                value={theme}
                options={THEME_MODES.map((mode) => ({ value: mode, label: tc(`theme.${mode}`) }))}
                onChange={(mode) => setTheme(mode as ThemeMode)}
              />
            </li>
            <li className="flex min-h-14 items-center gap-3 px-4">
              <Globe className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">{tc('language.label')}</span>
              <Segmented
                ariaLabel={tc('language.label')}
                value={locale}
                options={locales.map((code) => ({ value: code, label: localeNames[code] }))}
                onChange={(code) => setLocale(code as typeof locale)}
              />
            </li>
            <li>
              <button type="button" className={ROW} onClick={act(() => startTour())}>
                <Compass className="text-muted-foreground size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{t('userMenu.productTour')}</span>
              </button>
            </li>
            {help.map(row)}
            {feedbackAvailable && (
              <li>
                <button type="button" className={ROW} onClick={act(() => openFeedbackThreads())}>
                  <MessagesSquare className="text-muted-foreground size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{tFeedback('threads.open')}</span>
                  {feedbackUpdatedCount > 0 && (
                    <CountPill tone="attention" aria-label={tFeedback('threads.newCount', { count: feedbackUpdatedCount })}>
                      {feedbackUpdatedCount}
                    </CountPill>
                  )}
                </button>
              </li>
            )}
            {authRequired && (
              <li>
                <button type="button" className={ROW} onClick={act(() => void signOut())}>
                  <LogOut className="text-muted-foreground size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{tc('actions.signOut')}</span>
                </button>
              </li>
            )}
          </Group>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="pt-1">
      <SectionLabel as="h3" id={id} className="block px-4 pb-1 pt-2">
        {label}
      </SectionLabel>
      <ul>{children}</ul>
    </section>
  )
}

function DestinationRow({
  destination,
  label,
  current,
  onNavigate,
}: {
  destination: MoreDestination
  label: string
  current: boolean
  onNavigate: () => void
}): JSX.Element {
  const Icon = destination.icon
  return (
    <li>
      <Link
        href={destination.href}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        data-destination={destination.key}
        className={ROW}
      >
        <Icon aria-hidden className="text-muted-foreground size-5 shrink-0" />
        <span className={cn('min-w-0 flex-1', current && 'font-medium')}>{label}</span>
        {current ? (
          <Check className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
      </Link>
    </li>
  )
}

/** A short choice as a segmented row: the value is visible, one tap changes it. */
function Segmented({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      segmented
      size="sm"
      value={value}
      // Radix reports '' when the selected item is tapped again; a choice stays chosen.
      onValueChange={(next) => next && onChange(next)}
      aria-label={ariaLabel}
      // One width and one right edge for both controls, segments of one size.
      className="w-44 shrink-0"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
