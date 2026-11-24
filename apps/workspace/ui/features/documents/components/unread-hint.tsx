'use client'

import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export function UnreadHint({ count, onShow }: { count: number; onShow: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <p className="bg-warning-subtle text-warning flex items-center gap-2 rounded-control px-3 py-2 text-[13px] leading-5" role="status" data-testid="unread-hint">
      <Sparkles className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{t('brief.unreadHint', { count })}</span>
      <button type="button" onClick={onShow} className="hover:text-foreground focus-visible:ring-ring shrink-0 rounded-inline font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2" data-testid="unread-hint-show">
        {t('brief.unreadHintShow')}
      </button>
    </p>
  )
}
