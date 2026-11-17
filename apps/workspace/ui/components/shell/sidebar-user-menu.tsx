'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Brain,
  Building2,
  Check,
  ChevronsUpDown,
  Compass,
  Globe,
  LogOut,
  MessagesSquare,
  Monitor,
  Moon,
  ServerCog,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'

import { useAuth } from '@/adapters/auth/use-auth'
import { AttentionDot } from '@/components/ui/attention-dot'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CountPill } from '@/components/ui/count-pill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLayoutStore } from '@/features/layout/store'
import { useStartProductTour } from '@/features/onboarding/components/product-tour'
import {
  useFeedbackAvailable,
  useFeedbackUpdatedCount,
  useOpenFeedbackThreads,
} from '@/features/product-feedback/components'
import type { ThemeMode } from '@/features/layout/types'
import { useTranslations, useLocale, locales } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import type { SwitchableOrganization } from '@/lib/organizations/switchable'
import { OrganizationSwitcherMenu } from './organization-switcher'

export interface SidebarUser {
  name?: string | null
  email?: string | null
  image?: string | null
}

export interface SidebarUserMenuProps {
  user?: SidebarUser
  authRequired: boolean
  menuSide?: 'top' | 'bottom' | 'right'
  menuAlign?: 'start' | 'end'
  menuSideOffset?: number
  menuMatchTrigger?: boolean
  compact?: boolean
  canManageOrganization?: boolean
  canViewOrganization?: boolean
  canManagePlatform?: boolean
  organizations?: readonly SwitchableOrganization[]
  avatarSizeClass?: string
  organizationName?: string | null
  tourAnchor?: string
}

const THEME_ICONS: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

export function SidebarUserMenu({
  user,
  authRequired,
  menuSide = 'top',
  menuAlign = 'start',
  menuSideOffset = 4,
  menuMatchTrigger = false,
  compact = false,
  canManageOrganization = false,
  canViewOrganization = false,
  canManagePlatform = false,
  organizations = [],
  avatarSizeClass = 'size-[30px]',
  organizationName = null,
  tourAnchor,
}: SidebarUserMenuProps) {
  const { user: authUser, signOut } = useAuth()
  const theme = useLayoutStore((s) => s.theme)
  const setTheme = useLayoutStore((s) => s.setTheme)
  const t = useTranslations(navCopy)
  const tc = useTranslations(commonCopy)
  const { locale, setLocale, localeNames } = useLocale()
  const ActiveThemeIcon = THEME_ICONS[theme]
  const startTour = useStartProductTour()
  const openFeedbackThreads = useOpenFeedbackThreads()
  const feedbackUpdatedCount = useFeedbackUpdatedCount()
  const feedbackAvailable = useFeedbackAvailable()
  const tFeedback = useTranslations(feedbackCopy)

  const displayName = user?.name || user?.email || t('userMenu.defaultUser')
  const initial =
    String(displayName)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase() || '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'group/user flex items-center text-left text-sm',
          'transition-[color,background-color,transform] duration-quick ease-out hover:bg-desk in-data-[sidebar=sidebar]:hover:bg-selected',
          'data-[state=open]:bg-desk in-data-[sidebar=sidebar]:data-[state=open]:bg-selected',
          'active:scale-[0.98] motion-reduce:transition-none',
          compact
            ? 'w-auto rounded-full p-0 pointer-coarse:size-11 pointer-coarse:justify-center'
            : // The 24px disc at 20–44 (the project mark's edge) and a 7px gap
              'w-full gap-[7px] rounded-control py-1.5 pl-2 pr-3',
        )}
        aria-label={
          feedbackUpdatedCount > 0
            ? `${t('userMenu.label', { name: displayName })}, ${tFeedback('threads.newsDot')}`
            : t('userMenu.label', { name: displayName })
        }
        data-tour={tourAnchor}
      >
        <span className="relative flex shrink-0">
          {/* A reply from the Piloti team waits under „Mein Feedback": the
              count is on that row, one level down, and without a mark here
              nobody opens the menu to find it. */}
          <AttentionDot show={feedbackUpdatedCount > 0} className="absolute -top-0.5 -right-0.5 z-10" />
          {/* The disc is a fill one step down from its plane: the kit's on
              paper, the picked grey on the rail's desk. White on the rail is
              where the reader is, and nothing else. */}
          <Avatar className={avatarSizeClass}>
            {(authUser?.image ?? user?.image) && <AvatarImage src={authUser?.image ?? user?.image ?? undefined} alt="" />}
            <AvatarFallback className="in-data-[sidebar=sidebar]:bg-selected in-data-[sidebar=sidebar]:text-foreground text-xs font-medium">
              {initial}
            </AvatarFallback>
          </Avatar>
        </span>
        {!compact && (
          <>
            {/* The person's name alone: the organisation's name heads its
                doorways just above, and the menu's header says it too. */}
            {/* 13px at 500, muted as the rail's rows at rest: one step under the 14px ink it had (owner decision 2026-11-11). */}
            <span className="text-muted-foreground group-hover/user:text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">{displayName}</span>
            {/* Says the row opens something, as the switcher's chevrons do. */}
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={menuAlign}
        side={menuSide}
        sideOffset={menuSideOffset}
        className={cn(
          menuMatchTrigger ? 'w-(--radix-dropdown-menu-trigger-width)' : 'w-56',
          'motion-reduce:animate-none'
        )}
      >
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{displayName}</span>
            {user?.email && user?.name && (
              <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
            )}
            {/* Where the rail is expanded its heading names the organisation
                already; the avatar alone (the org header, the icon rail) does not. */}
            {organizationName && compact && (
              <span className="text-xs font-normal text-muted-foreground">{organizationName}</span>
            )}
            {!authRequired && (
              <span className="text-xs font-normal text-muted-foreground">{t('userMenu.authNotConfigured')}</span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/profile">
            <UserRound className="size-4 text-muted-foreground" aria-hidden />
            {t('userMenu.profile')}
          </Link>
        </DropdownMenuItem>
        {/* The person's own notes (ADR-0180), beside the profile: both are about them, outside any project. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/memory" data-testid="user-menu-memory">
            <Brain className="size-4 text-muted-foreground" aria-hidden />
            {t('userMenu.memory')}
          </Link>
        </DropdownMenuItem>
        {(canViewOrganization || canManageOrganization) && (
          <DropdownMenuItem asChild className="gap-2">
            <Link href="/app/organization">
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
              {t('userMenu.organization')}
            </Link>
          </DropdownMenuItem>
        )}
        {organizations.length > 1 && <OrganizationSwitcherMenu organizations={organizations} />}
        {/* The platform entry is shown only to the platform owner. */}
        {canManagePlatform && (
          <DropdownMenuItem asChild className="gap-2">
            <Link href="/app/platform">
              {/* Its own glyph: the grid was Übersicht's in the rail. */}
              <ServerCog className="size-4 text-muted-foreground" aria-hidden />
              {t('userMenu.platform')}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* Theme and language are second-order settings: one submenu row each
            (two clicks) instead of eight standing rows, so the menu is short
            enough to scan. The trigger row names the CURRENT value — the one
            fact a reader checks more often than they change it. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={tc('theme.label')}>
            <ActiveThemeIcon className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">{tc('theme.label')}</span>
            <span className="text-xs font-normal text-muted-foreground">{tc(`theme.${theme}`)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {THEME_MODES.map((mode) => {
              const Icon = THEME_ICONS[mode]
              return (
                <DropdownMenuItem key={mode} onSelect={(e) => { e.preventDefault(); setTheme(mode) }} className="gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{tc(`theme.${mode}`)}</span>
                  {theme === mode && <Check className="size-4" aria-hidden />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={tc('language.label')}>
            <Globe className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">{tc('language.label')}</span>
            <span className="text-xs font-normal text-muted-foreground">{localeNames[locale]}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {locales.map((code) => (
              <DropdownMenuItem key={code} onSelect={(e) => { e.preventDefault(); setLocale(code) }} className="gap-2">
                <span className="flex-1">{localeNames[code]}</span>
                {locale === code && <Check className="size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* The tour lives on the projects home; from anywhere else this
            navigates there first. */}
        <DropdownMenuItem onSelect={() => startTour()} className="gap-2">
          <Compass className="size-4 text-muted-foreground" aria-hidden />
          {t('userMenu.productTour')}
        </DropdownMenuItem>
        {/* Every change to the product, week by week (ADR-0156): beside the tour,
            because both are about the product itself, not the office's work. */}
        <DropdownMenuItem asChild className="gap-2">
          <Link href="/app/whats-new">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            {t('userMenu.whatsNew')}
          </Link>
        </DropdownMenuItem>
        {/* The one door to the people who build Piloti, next to the tour
            because both are "help with Piloti itself": „Mein Feedback" holds
            the replies and „Neues Feedback" alike. The pill says how many
            threads have news since the member last looked. */}
        {feedbackAvailable && (
          <DropdownMenuItem
            onSelect={() => openFeedbackThreads()}
            className="gap-2"
            data-testid="user-menu-feedback-threads"
          >
            <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">{tFeedback('threads.open')}</span>
            {feedbackUpdatedCount > 0 && (
              <CountPill tone="attention" aria-label={tFeedback('threads.newCount', { count: feedbackUpdatedCount })}>
                {feedbackUpdatedCount}
              </CountPill>
            )}
          </DropdownMenuItem>
        )}
        {authRequired && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut()} className="gap-2">
              <LogOut className="size-4 text-muted-foreground" aria-hidden />
              {tc('actions.signOut')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
