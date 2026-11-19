'use client'

import { createElement, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { documentFilesHref } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { CLAUSE_JOIN } from '@/lib/format'
import type { InboundMailDecision, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { InboundMailClient } from './client'
import { filedLines } from './filed'
import { awaitLanding, landedPlaces } from './inbox-landing'

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

export function useBulkLandingReport({
  client,
  projectId,
  pollMs,
  onSettled,
  onShowHandled,
}: {
  client: Pick<InboundMailClient, 'get'>
  projectId: string
  pollMs?: number
  onSettled: () => void
  onShowHandled: () => void
}): (sent: readonly InboundMailView[], decisions: readonly InboundMailDecision[], toastId: string | number) => Promise<void> {
  const t = useTranslations(inboundMailCopy)
  const router = useRouter()
  return useCallback(
    async (sent, decisions, toastId) => {
      const landings = await Promise.all(
        decisions.flatMap((decision) => {
          const view = sent.find((mail) => mail.id === decision.mailId)
          if (!view) return []
          const partIds = [...decision.parts.map((part) => part.partId), ...(decision.message ? [decision.message.partId] : [])]
          return [awaitLanding(view, partIds, () => client.get(projectId, view.id), { pollMs })]
        })
      )
      const places = landedPlaces(landings, t('suggestion.root'))
      const lines = [
        ...places.threads.map((thread) => t('toast.manyTexts', { count: thread.count, name: thread.name })),
        ...places.folders.map((folder) => t('toast.manyFiles', { count: folder.count, folder: folder.name })),
      ]
      const description = lines.length > 0 ? createElement('span', { className: 'flex min-w-0 flex-col', 'data-testid': 'bulk-landed' }, ...lines.map((line) => createElement('span', { key: line }, line))) : undefined
      const view = places.documentIds.length === 0
        ? undefined
        : {
            label: t('toast.view'),
            onClick: () => (places.documentIds.length === 1 ? router.push(documentFilesHref(projectId, places.documentIds[0])) : onShowHandled()),
          }
      if (places.failed > 0) toast.error(t('toast.manyFailed', { failed: places.failed }), { id: toastId, description, action: view })
      else if (places.pending > 0) toast.info(t('toast.filedAsSuggested', { count: decisions.length }), { id: toastId, description })
      else toast.success(t('toast.filedMany', { count: places.mails }), { id: toastId, description, action: view })
      onSettled()
    },
    [client, projectId, pollMs, onSettled, onShowHandled, t, router]
  )
}
