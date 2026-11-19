'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, type JSX } from 'react'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BackLink } from '@/components/shell/back-link'
import { BaseKnowledgeWorkspace, useNormRecognition } from '@/features/base-knowledge'
import { OfficeShelfPlaces, OFFICE_SHELF_NORMS_HREF } from '@/features/documents/components/office-shelf-places'
import { writeTrail } from '@/lib/navigation/return-trail'
import {
  byAttention,
  countByFolder,
  countEntries,
  matchesQuery,
  subtreeOf,
} from '@/lib/base-knowledge/office/listing'
import type { BaseKnowledgeEntry, BaseKnowledgeList, ListEntriesQuery } from '@/lib/base-knowledge/wire'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES, NORM_RECOGNITION } from '../_fixtures/base-knowledge'
import { buildPdf, type PdfLine } from '../_fixtures/sample-pdf'

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
  writeTrail([
    { path: '/app/projects/p1/files', label: 'Stadthaus Wien' },
    { path: window.location.pathname },
  ])
  const w = window as unknown as { __baseKnowledgeShim?: boolean }
  if (!w.__baseKnowledgeShim) {
    w.__baseKnowledgeShim = true
    const real = window.fetch.bind(window)
    const added: BaseKnowledgeEntry[] = []
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
      if (url.pathname === '/api/base-knowledge/recognize') {
        return Response.json(
          variant === 'plain-upload'
            ? { ...NORM_RECOGNITION, proposals: [], plain: [{ documentId: 'doc_plain', fileName: 'Plankopf_Vorlage_A0.pdf', folderId: 'f-plan', folderPath: 'Planung', platformHeld: false }] }
            : NORM_RECOGNITION,
        )
      }
      if (url.pathname === '/api/base-knowledge/settle') {
        const { rows } = JSON.parse(String(init?.body)) as { rows: { entryId: string; notNorm?: boolean; editionLabel?: string | null }[] }
        return Response.json({
          results: rows.map((row) => ({
            entryId: row.entryId,
            outcome: row.notNorm ? 'not_norm' : row.editionLabel ? 'confirmed' : 'edition_missing',
            error: null,
          })),
        })
      }
      if (url.pathname === '/api/base-knowledge/upload' || (url.pathname === '/api/base-knowledge' && init?.method === 'POST')) {
        const proposals = BASE_KNOWLEDGE_ENTRIES.filter((candidate) => candidate.status === 'proposed')
        const proposal = { ...proposals[added.length % proposals.length], id: `added-${added.length + 1}` }
        added.push(proposal)
        return Response.json(proposal)
      }
      const entryId = /^\/api\/base-knowledge\/([^/]+)/.exec(url.pathname)?.[1]
      const entry = entryId ? [...BASE_KNOWLEDGE_ENTRIES, ...added].find((candidate) => candidate.id === decodeURIComponent(entryId)) : undefined
      if (entry) return Response.json(url.pathname.endsWith('/confirm') ? { ...entry, status: 'confirmed' } : entry)
      if (url.pathname.startsWith('/api/base-knowledge')) return Response.json({ results: [] })
      const doc = /^\/api\/documents\/([^/]+)\/(status|file|preview|details|versions|visual-details|annotations)$/.exec(url.pathname)
      const held = doc ? BASE_KNOWLEDGE_ENTRIES.find((candidate) => candidate.documentId === decodeURIComponent(doc[1])) : undefined
      if (doc && held) {
        if (doc[2] === 'status') {
          return Response.json({ id: held.documentId, filename: held.fileName, contentType: 'application/pdf', status: 'completed', fileSize: 1_843_200, pageCount: 1, createdAt: held.createdAt })
        }
        if (doc[2] === 'file') {
          const page: PdfLine[] = [
            [held.values.designation ?? held.values.title, 22, true],
            [held.values.title, 13, false],
            [`Ausgabe ${held.values.editionLabel}`, 11, false],
            ['', 11, false],
            ['1 Anwendungsbereich', 14, true],
            ['Diese Norm gilt für die Planung und Errichtung von Bauwerken.', 11, false],
          ]
          return new Response(buildPdf([page]), { headers: { 'Content-Type': 'application/pdf' } })
        }
        if (doc[2] === 'preview') return Response.json({ url: `/api/documents/${held.documentId}/file`, contentType: 'application/pdf' })
        if (doc[2] === 'annotations') return Response.json({ annotations: [], canAnnotate: true })
        return Response.json(doc[2] === 'versions' ? { versions: [] } : doc[2] === 'visual-details' ? { details: [] } : {})
      }
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

function PlainUploadToast(): null {
  const { recognize } = useNormRecognition()
  useEffect(() => {
    void recognize(['doc_plain'], { announcePlain: true })
  }, [recognize])
  return null
}

function Preview(): JSX.Element {
  const variant = useSearchParams().get('variant')
  return (
    <main className="mx-auto flex max-w-6xl flex-col p-6" data-testid="base-knowledge-preview">
      <BackLink fallbackHref="/app/projects" fallbackLabel="Back to projects" />
      <div className="shadow-xs mt-3 flex h-[820px] flex-col overflow-hidden rounded-xl border">
        <BaseKnowledgeWorkspace
          key={variant ?? 'default'}
          uploadCollection="archiv_preview"
          organizationName="Atelier Nord"
          places={<OfficeShelfPlaces pathname={OFFICE_SHELF_NORMS_HREF} />}
        />
      </div>
      {variant === 'plain-upload' && <PlainUploadToast />}
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
