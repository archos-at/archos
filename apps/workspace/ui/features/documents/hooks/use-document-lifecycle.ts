'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import {
  DocumentLifecycleError,
  documentLifecycleClient,
  type DocumentLifecycleClient,
} from '@/lib/documents/lifecycle-client'
import type {
  DocumentLifecycle,
  DocumentVersionListResponse,
  DocumentVersionView,
} from '@/lib/documents/lifecycle-types'
import {
  lifecycleRequestFor,
  type DocumentLifecycleAction,
  type DocumentLifecycleGesture,
} from '../lib/document-lifecycle'
import type { ReviewerOption } from '../components/document-review-controls'

function isHeldRefusal(error: DocumentLifecycleError): boolean {
  const details = error.details
  return (
    error.status === 409 &&
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === 'held'
  )
}

export function newestVersion(versions: readonly DocumentVersionView[]): DocumentVersionView | null {
  return versions.reduce<DocumentVersionView | null>(
    (newest, version) =>
      newest === null || version.versionNumber > newest.versionNumber ? version : newest,
    null,
  )
}

const OPTIMISTIC_STATE: Record<
  Exclude<DocumentLifecycleAction, 'archive'>,
  DocumentVersionView['state']
> = {
  submit: 'in_review',
  approve: 'published',
  request_changes: 'changes_requested',
  reject: 'rejected',
  publish: 'published',
}

export interface DocumentLifecycleSummary {
  documentId: string
  state: DocumentVersionView['state']
  versionCount: number
  lifecycle: DocumentLifecycle
}

export interface ActOptions {
  comment?: string
  reviewerUserIds?: readonly string[]
  orderMessage?: string
  dueAt?: string
}

export interface UseDocumentLifecycleOptions {
  documentId: string
  enabled?: boolean
  withReviewers?: boolean
  client?: DocumentLifecycleClient
  onChanged?: (summary: DocumentLifecycleSummary) => void
}

export interface DocumentLifecyclePosition {
  listing: DocumentVersionListResponse | null
  loading: boolean
  failed: boolean
  pending: DocumentLifecycleGesture | null
  reviewers: readonly ReviewerOption[]
  act: (gesture: DocumentLifecycleGesture, options?: ActOptions) => Promise<void>
}

export function useDocumentLifecycle({
  documentId,
  enabled = true,
  withReviewers = false,
  client = documentLifecycleClient,
  onChanged,
}: UseDocumentLifecycleOptions): DocumentLifecyclePosition {
  const t = useTranslations(filesCopy)
  const [listing, setListing] = useState<DocumentVersionListResponse | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<DocumentLifecycleGesture | null>(null)
  const [reviewers, setReviewers] = useState<readonly ReviewerOption[]>([])

  const currentId = useRef(documentId)
  currentId.current = documentId

  const load = useCallback(async () => {
    const id = documentId
    setLoading(true)
    try {
      const next = await client.listVersions(id)
      if (currentId.current !== id) return
      setListing(next)
      setFailed(false)
    } catch {
      if (currentId.current !== id) return
      setFailed(true)
    } finally {
      if (currentId.current === id) setLoading(false)
    }
  }, [client, documentId])

  useEffect(() => {
    setListing(null)
    setFailed(false)
    if (!enabled) {
      setLoading(false)
      return
    }
    void load()
  }, [enabled, load])

  useEffect(() => {
    setReviewers([])
    if (!enabled || !withReviewers) return
    let live = true
    void fetch(`/api/documents/${encodeURIComponent(documentId)}/versions/reviewers`)
      .then((response) => (response.ok ? response.json() : { candidates: [] }))
      .then((body: { candidates?: ReviewerOption[] }) => {
        if (live) setReviewers(body.candidates ?? [])
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [documentId, enabled, withReviewers])

  const announce = useCallback(
    (next: DocumentVersionListResponse) => {
      const newest = newestVersion(next.versions)
      if (!newest) return
      onChanged?.({
        documentId,
        state: newest.state,
        versionCount: next.versions.length,
        lifecycle: next.lifecycle,
      })
    },
    [documentId, onChanged],
  )

  const act = useCallback(
    async (gesture: DocumentLifecycleGesture, options: ActOptions = {}) => {
      const { comment, reviewerUserIds, orderMessage, dueAt } = options
      if (!listing) return
      const version = newestVersion(listing.versions)
      if (!version) return
      const previous = listing
      const { action, delegateRevision } = lifecycleRequestFor(gesture)

      setListing(
        action === 'archive'
          ? { ...listing, lifecycle: 'archived' }
          : {
              ...listing,
              versions: listing.versions.map((row) =>
                row.id === version.id ? { ...row, state: OPTIMISTIC_STATE[action] } : row,
              ),
            },
      )
      setPending(gesture)

      try {
        if (action === 'archive') {
          await client.archive(documentId)
        } else {
          await runVersionOp(client, action, documentId, version.id, {
            comment,
            delegateRevision,
            reviewerUserIds,
            orderMessage,
            dueAt,
            ifMatch: version.contentHash ?? undefined,
          })
        }
        const next = await client.listVersions(documentId)
        if (currentId.current !== documentId) return
        setListing(next)
        announce(next)
      } catch (error) {
        if (currentId.current === documentId) setListing(previous)
        if (error instanceof DocumentLifecycleError && isHeldRefusal(error)) {
          toast.error(t('lifecycle.errors.held'))
        } else if (error instanceof DocumentLifecycleError && error.status === 409) {
          toast.error(t('lifecycle.errors.conflict'))
          await load()
        } else if (error instanceof DocumentLifecycleError && error.code === 'CONVERSATION_CONFINED') {
          toast.error(error.message)
        } else {
          toast.error(t('lifecycle.errors.actionFailed'))
        }
      } finally {
        setPending(null)
      }
    },
    [announce, client, documentId, listing, load, t],
  )

  return { listing, loading, failed, pending, reviewers, act }
}

async function runVersionOp(
  client: DocumentLifecycleClient,
  action: Exclude<DocumentLifecycleAction, 'archive'>,
  documentId: string,
  versionId: string,
  {
    comment,
    delegateRevision = false,
    reviewerUserIds,
    orderMessage,
    dueAt,
    ifMatch,
  }: ActOptions & { delegateRevision?: boolean; ifMatch?: string },
): Promise<void> {
  const calls: Record<typeof action, () => Promise<DocumentVersionView>> = {
    submit: () => client.submit(documentId, versionId, reviewerUserIds, { orderMessage, dueAt }),
    approve: () => client.approve(documentId, versionId, comment, ifMatch),
    request_changes: () =>
      delegateRevision
        ? client.requestChanges(documentId, versionId, comment ?? '', true, ifMatch)
        : client.requestChanges(documentId, versionId, comment ?? '', undefined, ifMatch),
    reject: () => client.reject(documentId, versionId, comment ?? '', ifMatch),
    publish: () => client.publish(documentId, versionId),
  }
  await calls[action]()
}
