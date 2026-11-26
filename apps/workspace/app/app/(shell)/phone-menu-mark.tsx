'use client'

import type { JSX } from 'react'

import { AttentionDot } from '@/components/ui/attention-dot'
import { useInboxBadge } from '@/features/collaboration/hooks/use-inbox'
import { useFeedbackUpdatedCount } from '@/features/product-feedback/components'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'

export function PhoneMenuMark({ canAccessInbox }: { canAccessInbox: boolean }): JSX.Element | null {
  const t = useTranslations(navCopy)
  const isMobile = useIsMobile()
  const { pending } = useInboxBadge(canAccessInbox && isMobile)
  const feedbackNews = useFeedbackUpdatedCount() > 0
  return <AttentionDot show={pending > 0 || feedbackNews} label={t('phoneMenu.news')} className="absolute right-2 top-2" />
}
