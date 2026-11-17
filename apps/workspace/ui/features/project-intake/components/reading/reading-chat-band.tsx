'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { BellRing, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { intakeReadingStepCopy } from '@/i18n/namespaces/intake-reading-step'

export const projectChatHref = (projectId: string): string => `/app/projects/${encodeURIComponent(projectId)}/chat`

export function ReadingChatBand({
  projectId,
  message,
  notify,
  early,
}: {
  projectId: string
  message: string
  notify: boolean
  early: boolean
}): JSX.Element {
  const t = useTranslations(intakeReadingStepCopy)
  return (
    <div
      role="status"
      className="bg-muted flex flex-col gap-3 rounded-xl px-4 py-3.5 sm:flex-row sm:items-center"
      data-testid="reading-band"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        {notify && <BellRing aria-hidden className="mt-0.5 size-[18px] shrink-0 sm:mt-0" />}
        <p className="min-w-0 text-sm">{message}</p>
      </div>
      <Button asChild variant="secondary" className="bg-card h-11 shrink-0 text-[13px] sm:h-[34px] sm:px-3">
        <Link href={projectChatHref(projectId)} aria-label={t('chat.aria')} data-testid="reading-ask-chat">
          <MessageSquare aria-hidden className="size-3.5" />
          {early ? t('chat.early') : t('chat.label')}
        </Link>
      </Button>
    </div>
  )
}
