'use client'

import type { JSX } from 'react'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { motion, springGlide } from '@/components/motion'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { AttentionDot } from '@/components/ui/attention-dot'
import { InboxBadge } from '@/features/collaboration/components'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { useFeedbackUpdatedCount } from '@/features/product-feedback/components'
import { InboundMailWaitingBadge } from './inbound-mail-waiting-badge'
import { useInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { useShellOverlays } from './shell-overlays'
import { orgPhoneTabs, projectPhoneTabs, type PhoneTab, type PhoneTabLabel } from './phone-tabs'

export interface PhoneTabBarProps {
  projectId: string | null
  canAccessOfficeShelf: boolean
  canAccessInbox: boolean
  inboundMailEnabled?: boolean
  className?: string
  pathname?: string
}

export function PhoneTabBar({
  projectId,
  canAccessOfficeShelf,
  canAccessInbox,
  inboundMailEnabled = false,
  className,
  pathname: pinnedPathname,
}: PhoneTabBarProps): JSX.Element {
  const currentPathname = usePathname() ?? ''
  const pathname = pinnedPathname ?? currentPathname
  const t = useTranslations(navCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const isMobile = useIsMobile()
  const { pending } = useInboxBadge(canAccessInbox && isMobile)
  const inboundMail = useInboundMailWaiting(projectId, inboundMailEnabled && isMobile)
  const moreOpen = useShellOverlays((s) => s.moreSheetOpen)
  const setMoreOpen = useShellOverlays((s) => s.setMoreSheetOpen)
  const feedbackNews = useFeedbackUpdatedCount() > 0
  const tFeedback = useTranslations(feedbackCopy)
  const pillId = `phone-tab-pill-${React.useId()}`

  const flags = { canAccessOfficeShelf, canAccessInbox }
  const tabs = projectId
    ? projectPhoneTabs(projectId, pathname, flags)
    : orgPhoneTabs(pathname, flags)
  const label = (value: PhoneTabLabel): string =>
    value.namespace === 'collaboration' ? tCollaboration(value.key) : t(value.key)

  return (
    <nav
      aria-label={t('tabBar.label')}
      data-slot="phone-tab-bar"
      data-scope={projectId ? 'project' : 'org'}
      className={cn(
        'w-full shrink-0 md:hidden',
        projectId ? 'bg-desk' : 'border-border bg-background border-t',
        'pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
        className
      )}
    >
      {/* On its side the bar is one row of icon-and-label pairs, so it takes
          the width it needs for whole labels rather than a portrait column. */}
      <ul className="mx-auto flex max-w-lg items-stretch px-1 landscape:max-w-3xl">
        {tabs.map((tab) => (
          <li key={tab.key} className="min-w-0 flex-1">
            <PhoneTabItem
              tab={tab}
              label={label(tab.label)}
              pillId={pillId}
              badgeCount={tab.key === 'inbox' ? pending : 0}
              newsLabel={tab.key === 'more' && feedbackNews ? tFeedback('threads.newsDot') : null}
              waitingCount={tab.key === 'files' ? inboundMail.count : null}
              waitingMore={tab.key === 'files' && inboundMail.more}
              expanded={tab.key === 'more' ? moreOpen : undefined}
              onOpenMore={() => setMoreOpen(true)}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function PhoneTabItem({
  tab,
  label,
  pillId,
  badgeCount,
  newsLabel,
  waitingCount = null,
  waitingMore = false,
  expanded,
  onOpenMore,
}: {
  tab: PhoneTab
  label: string
  pillId: string
  badgeCount: number
  newsLabel: string | null
  waitingCount?: number | null
  waitingMore?: boolean
  expanded?: boolean
  onOpenMore: () => void
}): JSX.Element {
  const Icon = tab.icon
  const className = cn(
    'relative flex h-[3.25rem] w-full flex-col items-center justify-center gap-1 rounded-control outline-none',
    '[@media(max-height:31rem)]:h-11 [@media(max-height:31rem)]:flex-row [@media(max-height:31rem)]:gap-2',
    PRESSABLE,
    FOCUS_RING_INSET,
    tab.active ? 'text-foreground' : 'text-muted-foreground'
  )
  const body = (
    <>
      <span className="relative flex h-7 w-12 shrink-0 items-center justify-center [@media(max-height:31rem)]:w-10">
        {tab.active && (
          <motion.span
            layoutId={pillId}
            data-slot="phone-tab-pill"
            aria-hidden
            className="bg-desk in-data-[scope=project]:bg-sheet in-data-[scope=project]:shadow-xs absolute inset-0 rounded-control"
            transition={springGlide}
          />
        )}
        <Icon aria-hidden className="relative size-[1.125rem]" />
        {/* Beside the glyph's top-right corner rather than over it. */}
        <InboxBadge pending={badgeCount} tone="muted" className="absolute -top-1 left-[calc(50%+5px)]" />
        <AttentionDot show={newsLabel !== null} label={newsLabel ?? undefined} className="absolute top-0 right-2.5" />
        {badgeCount <= 0 && <InboundMailWaitingBadge count={waitingCount} more={waitingMore} className="absolute -top-1 left-[calc(50%+5px)]" />}
      </span>
      <span
        data-slot="phone-tab-label"
        className={cn(
          'relative max-w-full truncate px-0.5 text-xs leading-none',
          tab.active ? 'font-semibold' : 'font-medium'
        )}
      >
        {label}
      </span>
    </>
  )

  if (tab.href === null) {
    return (
      <button
        type="button"
        onClick={onOpenMore}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        data-tour={tab.tourAnchor}
        data-tour-placement="above"
        data-state={tab.active ? 'active' : 'inactive'}
        className={className}
      >
        {body}
      </button>
    )
  }

  return (
    <Link
      href={tab.href}
      aria-current={tab.active ? 'page' : undefined}
      data-tour={tab.tourAnchor}
      data-tour-placement="above"
      data-state={tab.active ? 'active' : 'inactive'}
      className={className}
    >
      {body}
    </Link>
  )
}
