'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { BackLink } from '@/components/shell/back-link'
import { writeTrail } from '@/lib/navigation/return-trail'
import { OfficeShelfWorkspace } from '@/features/documents/components/office-shelf-workspace'
import { OfficeShelfPlaces, OFFICE_SHELF_FILES_HREF } from '@/features/documents/components/office-shelf-places'
import type { FileItem, FolderItem } from '@/features/documents/file-types'
import { OfficeShelfWithNorms } from '@/features/base-knowledge'
import type { NormRecognition } from '@/adapters/api/base-knowledge-client'
import type { FolderNorm, FolderNormsDecision } from '@/lib/office-shelf/folder-norms-wire'
import { NORM_RECOGNITION } from '../_fixtures/base-knowledge'

function makeFile(
  id: string,
  filename: string,
  summary: string,
  tags: string[],
  folderId: string | null,
  extra: Partial<FileItem> = {}
): FileItem {
  return {
    id,
    filename,
    displayName: null,
    fileSize: 2_400_000,
    contentType: 'application/pdf',
    status: 'ready',
    folderId,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary,
    pageCount: 24,
    chunkCount: 48,
    contentTypes: ['text', 'table'],
    tags,
    topics: null,
    capture: null,
    ...extra,
  }
}

const folder = (id: string, name: string, path: string, parentId: string | null): FolderItem => ({
  id,
  parentId,
  name,
  path,
  createdAt: '2026-06-01T09:00:00Z',
  updatedAt: '2026-06-10T09:00:00Z',
})

const FOLDERS: FolderItem[] = [
  folder('f-plan', 'Planung', 'Planung', null),
  folder('f-plan-eg', 'Erdgeschoss', 'Planung/Erdgeschoss', 'f-plan'),
  folder('f-recht', 'Baurecht', 'Baurecht', null),
]

const FILES: FileItem[] = [
  makeFile('a1', 'Referenzprojekt_Stadthaus-Wien.pdf', 'Vergleichbares Wohngebäude der GK 4.', ['Wohnbau', 'Referenz'], null),
  makeFile('a2', 'Detailkatalog_Treppen.pdf', 'Regeldetails für Treppenläufe und Geländer.', ['Detail', 'Treppen'], 'f-plan'),
  makeFile('a3', 'Brandschutz-Musterkonzept.pdf', 'Musterkonzept Brandschutz für GK 4–5.', ['Brandschutz', 'Muster'], 'f-recht'),
  makeFile('a4', 'Fassadendetails_Nord.png', 'Fassadendetails Nordansicht.', ['Detail', 'Fassade'], 'f-plan-eg', {
    contentType: 'image/png',
  }),
  makeFile('a5', 'Statik_Standardpositionen.pdf', 'Standard-Statikpositionen und Lastannahmen.', ['Statik'], null),
  makeFile('a6', 'Ausschreibung_Vorlage.docx', 'Ausschreibungsvorlage Rohbau.', ['Ausschreibung', 'Vorlage'], 'f-plan', {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }),
]

const NORMS_FOLDER = 'f-recht'

const NORM_FILES: FileItem[] = [
  makeFile('n1', 'OENORM_B_1600_2017.pdf', 'Barrierefreies Bauen, Planungsgrundlagen.', ['Norm', 'Barrierefreiheit'], NORMS_FOLDER),
  makeFile('n2', 'OIB-RL_4_2023.pdf', 'OIB-Richtlinie 4, Nutzungssicherheit und Barrierefreiheit.', ['Richtlinie'], NORMS_FOLDER),
]

const FOLDER_NORMS: FolderNorm[] = [
  { documentId: 'n1', fileName: 'OENORM_B_1600_2017.pdf', designation: 'ÖNORM B 1600' },
  { documentId: 'n2', fileName: 'OIB-RL_4_2023.pdf', designation: 'OIB-RL 4' },
]

type ShelfState = { files: FileItem[]; folders: FolderItem[]; normsDecided: boolean }

const isNormsVariant = (): boolean => new URLSearchParams(window.location.search).get('variant') === 'norms'

function recognition(documentIds: readonly string[], files: readonly FileItem[]): NormRecognition {
  const [template] = NORM_RECOGNITION.proposals
  return {
    ...NORM_RECOGNITION,
    proposals: files
      .filter((file) => documentIds.includes(file.id))
      .map((file) => ({ ...template, entryId: `recognised-${file.id}`, documentId: file.id, fileName: file.filename, editionOf: null })),
    plain: [],
  }
}

function answerNorms(path: string, method: string, body: string, state: ShelfState): Response | null {
  const folderNorms = /^\/api\/office-shelf\/folders\/([^/]+)\/norms$/.exec(path)
  if (folderNorms) {
    const folderId = decodeURIComponent(folderNorms[1])
    const norms = folderId === NORMS_FOLDER && !state.normsDecided ? FOLDER_NORMS : []
    if (method === 'GET') return json({ folderId, total: norms.length, norms, nextCursor: null })
    const { action } = JSON.parse(body || '{}') as { action: FolderNormsDecision['action'] }
    state.normsDecided = true
    const decision: FolderNormsDecision = { action, done: action === 'record' ? norms : [], failed: [], remaining: 0 }
    return json(decision)
  }
  if (path === '/api/base-knowledge/recognize') {
    const { documentIds } = JSON.parse(body || '{}') as { documentIds: string[] }
    return json(recognition(documentIds, state.files))
  }
  if (path === '/api/base-knowledge/settle') {
    const { rows } = JSON.parse(body || '{}') as { rows: { entryId: string; notNorm?: boolean }[] }
    return json({ results: rows.map((row) => ({ entryId: row.entryId, outcome: row.notNorm ? 'not_norm' : 'confirmed', error: null })) })
  }
  return null
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function answer(url: string, method: string, body: string, state: ShelfState): Response | null {
  const path = new URL(url, window.location.origin).pathname
  const norms = isNormsVariant() ? answerNorms(path, method, body, state) : null
  if (norms) return norms
  if (/\/api\/documents\/.+\/thumbnail$/.test(path)) return new Response(null, { status: 404 })
  if (path === '/api/documents' && method === 'GET') {
    return json({ documents: state.files, collectionName: 'archiv_dev', canManage: true })
  }
  if (path === '/api/office-shelf/folders' && method === 'GET') return json({ folders: state.folders })
  if (path === '/api/office-shelf/folders' && method === 'POST') {
    const created = folder(`f-${state.folders.length + 1}`, 'Neuer Ordner', 'Neuer Ordner', null)
    state.folders = [...state.folders, created]
    return json({ folder: created }, 201)
  }
  if (path.startsWith('/api/office-shelf/folders/') || path.endsWith('/folder')) return json({ ok: true, documentsMoved: 0, foldersMoved: 0 })
  return null
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  writeTrail([
    { path: '/app/projects/p1/files', label: 'Stadthaus Wien' },
    { path: window.location.pathname },
  ])

  const w = window as unknown as { __officeShelfShim?: boolean }
  if (!w.__officeShelfShim) {
    w.__officeShelfShim = true
    const real = window.fetch.bind(window)
    const params = new URLSearchParams(window.location.search)
    const memory: ShelfState = {
      files: params.get('state') === 'empty' ? [] : isNormsVariant() ? [...FILES, ...NORM_FILES] : FILES,
      folders: params.get('state') === 'empty' ? [] : FOLDERS,
      normsDecided: false,
    }
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (params.get('state') === 'loading' && url.includes('/api/office-shelf/')) return new Promise<Response>(() => {})
      return answer(url, init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : '', memory) ?? real(input, init)
    }
  }
}

export default function OfficeShelfLibraryDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const [readOnly, setReadOnly] = useState(false)
  const [withNorms, setWithNorms] = useState(false)
  useEffect(() => {
    setReadOnly(new URLSearchParams(window.location.search).get('state') === 'readonly')
    setWithNorms(isNormsVariant())
  }, [])
  const places = <OfficeShelfPlaces pathname={OFFICE_SHELF_FILES_HREF} />

  return (
    <main className="mx-auto flex max-w-6xl flex-col p-6">
      <BackLink fallbackHref="/app/projects" fallbackLabel="Back to projects" />
      <div className="shadow-xs mt-3 flex h-[820px] flex-col overflow-hidden rounded-xl border">
        {withNorms ? (
          <OfficeShelfWithNorms canManage={!readOnly} organizationName="Atelier Nord" places={places} normsInFolders />
        ) : (
          <OfficeShelfWorkspace canManage={!readOnly} organizationName="Atelier Nord" places={places} />
        )}
      </div>
    </main>
  )
}
