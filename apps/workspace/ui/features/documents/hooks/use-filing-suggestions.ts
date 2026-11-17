'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveShelf } from '@/lib/documents/shelf-live-events'
import { listOpenProposals } from '@/lib/proposals/client'
import type { ListedProposal, ProposalListQuery } from '@/lib/proposals/types'
import {
  suggestionsByDocument,
  suggestionsByFolder,
  type FilingFolderSuggestion,
  type FilingSuggestionView,
} from '../lib/filing-suggestions'
import { useShelfLive } from '@/features/realtime/use-shelf-live'

export const FILING_FALLBACK_POLL_MS = 60_000

export interface FilingSuggestions {
  byDocument: ReadonlyMap<string, FilingSuggestionView>
  byFolder: readonly FilingFolderSuggestion[]
  reload: () => void
}

const EMPTY: readonly ListedProposal[] = []

export function useFilingSuggestions({
  query,
  refreshKey,
  watching,
}: {
  query: ProposalListQuery | null
  refreshKey?: unknown
  watching: boolean
}): FilingSuggestions {
  const [listed, setListed] = useState<readonly ListedProposal[]>(EMPTY)
  const projectId = query?.projectId
  const officeShelf = query?.shelf === 'office_shelf'
  const asked = query !== null
  const generation = useRef(0)

  const reload = useCallback(() => {
    if (!asked) return
    const mine = ++generation.current
    const shelf: ProposalListQuery = projectId ? { projectId, kind: 'file_operation' } : { shelf: 'office_shelf', kind: 'file_operation' }
    listOpenProposals(shelf).then(
      ({ proposals }) => {
        if (mine === generation.current) setListed(proposals)
      },
      () => undefined
    )
  }, [asked, projectId])

  useEffect(() => {
    reload()
  }, [reload, refreshKey, officeShelf])

  const liveShelf = useMemo<LiveShelf | null>(
    () => (projectId ? { kind: 'project', projectId } : asked ? { kind: 'office_shelf' } : null),
    [projectId, asked]
  )
  useShelfLive(liveShelf, reload, { enabled: watching })

  useEffect(() => {
    if (!watching || !asked) return
    const timer = setInterval(reload, FILING_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [watching, asked, reload])

  const byDocument = useMemo(() => suggestionsByDocument(listed), [listed])
  const byFolder = useMemo(() => suggestionsByFolder(listed), [listed])
  return { byDocument, byFolder, reload }
}
