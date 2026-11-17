'use client'

import type { JSX } from 'react'
import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { FilePreviewBridge } from '@/features/documents/components/file-preview-host'
import { MainLayout } from '@/features/layout/components/MainLayout'
import {
  FILE_PEEK_WIDTH_STORAGE_KEY,
  useFilePreviewStore,
} from '@/features/documents/stores/file-preview-store'
import { FLOOR_PLAN_DATA_URI } from '../../_fixtures/floor-plan'
import { buildPdf, type PdfLine } from '../../_fixtures/sample-pdf'
import type { FileItem } from '@/features/documents/components/project-file-workspace'

const FILE: FileItem = {
  id: 'doc-brandschutz',
  filename: 'Grundriss_EG_Baufeld_D12.svg',
  displayName: null,
  fileSize: 2_458_112,
  contentType: 'image/svg+xml',
  status: 'ready',
  folderId: null,
  createdAt: '2026-04-02T09:00:00.000Z',
  errorMessage: null,
  summary:
    'Grundriss des Erdgeschosses, Baufeld D12, Maßstab 1:100. Zeigt vier Nutzungseinheiten (Foyer, Büro 01, Technik, Lager) mit Flächenangaben, die beiden voneinander unabhängigen Fluchtwege und die Feuerwiderstandsklasse REI 90 der tragenden Wände. Stand 04/2026.',
  pageCount: 12,
  chunkCount: 48,
  contentTypes: ['text', 'drawing'],
  tags: ['Brandschutz'],
  topics: null,
  capture: null,
}

const PDF_FILE: FileItem = {
  ...FILE,
  id: 'doc-brandschutzkonzept',
  filename: 'Brandschutzkonzept_Wohnbau_Nord.pdf',
  contentType: 'application/pdf',
  fileSize: 1_284_096,
  pageCount: 2,
  summary:
    'Brandschutzkonzept für den Wohnbau Nord, Gebäudeklasse 4 nach OIB-Richtlinie 2 (2023). Beschreibt zwei unabhängige Fluchtwege je Nutzungseinheit, Brandabschnitte in REI 90, die Rauchableitung über das Treppenhaus und die Löschwasserversorgung.',
}

const PDF_PAGES: readonly (readonly PdfLine[])[] = [
  [
    ['Brandschutzkonzept Wohnbau Nord', 22, true],
    ['Gebäudeklasse 4 · OIB-Richtlinie 2 (2023)', 11, false],
    ['', 11, false],
    ['1. Fluchtwege', 14, true],
    ['', 11, false],
    ['Je Nutzungseinheit stehen zwei voneinander unabhängige Fluchtwege', 11, false],
    ['zur Verfügung: der erste über den notwendigen Flur in das nördliche', 11, false],
    ['Sicherheitstreppenhaus, der zweite über die anleiterbaren Fenster', 11, false],
    ['an der Ostfassade.', 11, false],
    ['', 11, false],
    ['2. Brandabschnitte', 14, true],
    ['', 11, false],
    ['Brandabschnitte sind mit Trennwänden REI 90 ausgeführt; die', 11, false],
    ['Wohnungstrennwände erreichen REI 60.', 11, false],
  ],
  [
    ['3. Rauchableitung', 14, true],
    ['', 11, false],
    ['Die Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage', 11, false],
    ['im Treppenhaus mit einer aerodynamisch wirksamen Öffnungsfläche', 11, false],
    ['von 1,0 m².', 11, false],
  ],
]

const CONTEXT = { projectId: 'proj-1', projectName: 'Seestadt Baufeld', scope: 'files' } as const

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const realFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/preview') && new URLSearchParams(window.location.search).get('variant') === 'gone') {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    if (url.includes('/file') && new URLSearchParams(window.location.search).get('variant') === 'pdf') {
      return Promise.resolve(
        new Response(buildPdf(PDF_PAGES), { status: 200, headers: { 'content-type': 'application/pdf' } }),
      )
    }
    if (url.includes('/preview')) {
      return Promise.resolve(
        new Response(JSON.stringify({ url: FLOOR_PLAN_DATA_URI }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return realFetch(input as RequestInfo, init)
  }) as typeof window.fetch
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const seed = new URLSearchParams(window.location.search).get('variant') ?? 'default'
  try {
    if (seed === 'wide') window.localStorage.setItem(FILE_PEEK_WIDTH_STORAGE_KEY, '720')
    else window.localStorage.removeItem(FILE_PEEK_WIDTH_STORAGE_KEY)
  } catch {
    // Storage unavailable — the preview still renders, at the default width.
  }
  if (seed !== 'arrive') {
    useFilePreviewStore.setState({
      file:
        seed === 'indexing'
          ? { ...FILE, status: 'processing' }
          : seed === 'failed'
            ? { ...FILE, status: 'failed', errorMessage: 'Seite 3: Text-Layer konnte nicht gelesen werden.', versionCount: 1 }
            : seed === 'failed-reupload'
              ? { ...FILE, status: 'failed', errorMessage: 'Seite 3: Text-Layer konnte nicht gelesen werden.', versionCount: 2 }
              : seed === 'pdf'
                ? PDF_FILE
                : FILE,
      mode: 'peek',
      hidden: seed === 'hidden',
      context: CONTEXT,
    })
  } else {
    useFilePreviewStore.setState({ file: null, mode: 'modal', hidden: false, context: CONTEXT })
  }
}

export default function FileAskSplitPreview(): JSX.Element {
  const variant = useSearchParams()?.get('variant') ?? 'default'

  useEffect(() => {
    if (variant !== 'arrive') return
    useFilePreviewStore.getState().open(FILE, 'peek', CONTEXT)
  }, [variant])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      {/* Copied from app/(shell)/layout.tsx — see the header note. */}
      <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row">
        <div
          className="bg-sidebar hidden w-[236px] shrink-0 border-r border-border md:block"
          aria-hidden
        />
        <main className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none">
          <div data-testid="file-ask-split-preview" data-variant={variant} className="contents">
            <FilePreviewBridge>
              {/* The REAL chat surface, not a stand-in. `MainLayout` keeps its
                  own inline width rule for the peek, and that rule is only
                  wrong in combination with the split around it — a stand-in
                  column would have hidden exactly the defect this route is
                  for. Every prop is optional and the stores are empty here, so
                  it renders its signed-out/empty state, which is enough: the
                  subject under test is the width of its column. */}
              <>
                {/* Drives the `arrive` variant the way Ask Piloti does: the
                    peek is opened AFTER the split has already mounted cold. */}
                <button
                  type="button"
                  data-testid="open-peek"
                  className="sr-only"
                  onClick={() => useFilePreviewStore.getState().open(FILE, 'peek', CONTEXT)}
                >
                  open peek
                </button>
                <MainLayout />
              </>
            </FilePreviewBridge>
          </div>
        </main>
      </div>
    </I18nProvider>
  )
}
