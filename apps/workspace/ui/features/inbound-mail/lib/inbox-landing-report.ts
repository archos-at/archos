'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { documentFilesHref } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { CLAUSE_JOIN } from '@/lib/format'
import type { InboundMailDecision, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { InboundMailClient } from './client'
import { filedLines } from './filed'
import { awaitLanding } from './inbox-landing'

export function useLandingReport({
  client,
  projectId,
  pollMs,
  onSettled,
}: {
  client: Pick<InboundMailClient, 'get'>
  projectId: string
  pollMs?: number
  onSettled: () => void
}): (sent: InboundMailView, decision: InboundMailDecision, toastId: string | number) => Promise<void> {
  const t = useTranslations(inboundMailCopy)
  const router = useRouter()
  return useCallback(
    async (sent, decision, toastId) => {
      const partIds = [...decision.parts.map((part) => part.partId), ...(decision.message ? [decision.message.partId] : [])]
      const landing = await awaitLanding(sent, partIds, () => client.get(projectId, sent.id), { pollMs })
      const failed = landing.failed.length
      if (failed > 0) {
        const title = landing.quota
          ? t('state.quotaFull')
          : landing.filed.length === 0
            ? t('state.partialFailureAll', { failed })
            : t('state.partialFailure', { failed, total: failed + landing.filed.length })
        toast.error(title, { id: toastId })
      } else if (landing.filed.length > 0) {
        const landed = landing.view.parts.filter((part) => landing.filed.includes(part.id))
        const files = landed.filter((part) => part.kind === 'attachment').length
        const text = landed.some((part) => part.kind === 'message')
        const firstDocument = landed.map((part) => part.documentId).find((id): id is string => !!id)
        const lines = filedLines(landing.view.parts, landing.filed, t('suggestion.root')).map(
          (line) =>
            (line.kind === 'message' ? t('toast.lineText', { name: line.place.name }) : t('toast.lineFile', { name: line.place.name, folder: line.place.folder })) +
            (line.place.version != null ? `${CLAUSE_JOIN}${t('attachments.status.version', { version: line.place.version })}` : '')
        )
        toast.success(files > 0 && text ? t('toast.filedBoth', { count: files }) : files > 0 ? t('toast.filed', { count: files }) : t('toast.textFiled'), {
          id: toastId,
          description: lines.length > 0 ? lines.join(CLAUSE_JOIN) : undefined,
          ...(firstDocument ? { action: { label: t('toast.view'), onClick: () => router.push(documentFilesHref(projectId, firstDocument)) } } : {}),
        })
      } else {
        toast.info(t('toast.filedAsSuggested', { count: 1 }), { id: toastId })
      }
      onSettled()
    },
    [client, projectId, pollMs, onSettled, t, router]
  )
}
