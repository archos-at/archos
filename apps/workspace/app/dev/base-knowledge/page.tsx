'use client'

/**
 * Dev preview for Grundlagen des Büros (ADR-0163): the real workspace over a
 * fetch shim. The shim narrows and counts with the service's own pure listing
 * (`listing.ts`), so the filters, counts and folder rail behave as they do on
 * the server. `?variant=empty` shows the first visit, `?variant=readonly` a
 * member who may read but not change. Not linked from anywhere; 404s outside
 * development.
 */

import { useSearchParams } from 'next/navigation'
import { Suspense, type JSX } from 'react'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BaseKnowledgeWorkspace } from '@/features/base-knowledge'
import {
  byAttention,
  countByFolder,
  countEntries,
  matchesQuery,
  subtreeOf,
} from '@/lib/base-knowledge/office/listing'
import type { BaseKnowledgeList, ListEntriesQuery } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES } from '../_fixtures/base-knowledge'

function list(url: URL, variant: string | null): BaseKnowledgeList {
  const entries = variant === 'empty' ? [] : BASE_KNOWLEDGE_ENTRIES
  const query = Object.fromEntries(url.searchParams) as Partial<ListEntriesQuery>
  const folders = [
    { id: BASE_KNOWLEDGE_FOLDERS.rootId!, parentId: null },
    ...BASE_KNOWLEDGE_FOLDERS.folders,
  ]
  const inFolder = query.folderId ? subtreeOf(query.folderId, folders) : null
  const scoped = entries.filter(
    (entry) => !inFolder || (entry.folderId !== null && inFolder.has(entry.folderId))
  )
  return {
    canManage: variant !== 'readonly',
    counts: countEntries(scoped),
    territories: BASE_KNOWLEDGE_TERRITORIES,
    folderCounts: countByFolder(entries),
    entries: scoped.filter((entry) => matchesQuery(entry, query)).sort(byAttention),
    nextCursor: null,
  }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __baseKnowledgeShim?: boolean }
  if (!w.__baseKnowledgeShim) {
    w.__baseKnowledgeShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const url = new URL(raw, window.location.origin)
      const variant = new URLSearchParams(window.location.search).get('variant')
      if (url.pathname === '/api/base-knowledge/folders') {
        return Response.json(
          variant === 'empty'
            ? { rootId: null, folders: [], nextCursor: null }
            : BASE_KNOWLEDGE_FOLDERS
        )
      }
      if (url.pathname === '/api/base-knowledge' && (init?.method ?? 'GET') === 'GET')
        return Response.json(list(url, variant))
      const entryId = /^\/api\/base-knowledge\/([^/]+)/.exec(url.pathname)?.[1]
      const entry = entryId ? BASE_KNOWLEDGE_ENTRIES.find((candidate) => candidate.id === decodeURIComponent(entryId)) : undefined
      // An entry's own path answers with the entry; a write leaves the fixture as it is.
      if (entry) return Response.json(entry)
      if (url.pathname.startsWith('/api/base-knowledge')) return Response.json({ results: [] })
      if (url.pathname === '/api/documents' && url.searchParams.get('scope') === 'office_shelf') {
        return Response.json({
          documents: [
            { id: 'doc_shelf_1', filename: 'OIB-RL_2_Brandschutz_2023.pdf', displayName: null },
            { id: 'doc_shelf_2', filename: 'Leitdetail_Attika.pdf', displayName: null },
          ],
        })
      }
      return real(input, init)
    }
  }
}

function Preview(): JSX.Element {
  const variant = useSearchParams().get('variant')
  return (
    <main
      className="bg-background mx-auto flex min-h-screen max-w-6xl flex-col"
      data-testid="base-knowledge-preview"
    >
      <BaseKnowledgeWorkspace key={variant ?? 'default'} />
    </main>
  )
}

export default function BaseKnowledgeDevPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <Suspense>
          <Preview />
        </Suspense>
      </TooltipProvider>
    </I18nProvider>
  )
}
