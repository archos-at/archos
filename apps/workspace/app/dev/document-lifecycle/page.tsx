'use client'

import type { JSX } from 'react'
import { use, useEffect, useRef } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { DocumentRevisions } from '@/features/documents/components/document-revisions'
import { DocumentLifecyclePosition } from '@/features/documents/components/document-lifecycle-position'
import { DocumentVersionStateBadge } from '@/features/documents/components/document-version-badge'
import type { DocumentLifecycleClient } from '@/lib/documents/lifecycle-client'
import type {
  DocumentVersionListResponse,
  DocumentVersionState,
  DocumentVersionView,
} from '@/lib/documents/lifecycle-types'
import { DOCUMENT_VERSION_STATES } from '@/lib/documents/lifecycle-types'
import type { FileItem } from '@/features/documents/file-types'
import { PRODUCT_NAME } from '@/lib/brand'

const REVIEWER = 'user_reviewer'
const AUTHOR = 'user_anna'

function version(
  versionNumber: number,
  state: DocumentVersionState,
  overrides: Partial<DocumentVersionView> = {},
): DocumentVersionView {
  return {
    id: `ver_${versionNumber}`,
    documentId: 'doc_1',
    versionNumber,
    state,
    contentType: 'text/markdown',
    fileSize: 18_400,
    contentHash: `sha256:${versionNumber}`,
    submittedBy: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    reviewComment: null,
    createdBy: AUTHOR,
    createdAt: '2026-09-02T07:30:00.000Z',
    updatedAt: '2026-09-02T07:30:00.000Z',
    ...overrides,
  }
}

function fixtureClient(listing: DocumentVersionListResponse): DocumentLifecycleClient {
  const refuse = () => Promise.reject(new Error('preview'))
  return {
    listVersions: () => Promise.resolve(listing),
    getVersion: refuse,
    forkDraft: refuse,
    replaceContent: refuse,
    submit: refuse,
    approve: refuse,
    requestChanges: refuse,
    reject: refuse,
    publish: refuse,
    archive: refuse,
    diff: refuse,
  } as DocumentLifecycleClient
}

const UPLOADED = fixtureClient({
  documentId: 'doc_0',
  lifecycle: 'active',
  publishedVersionId: 'ver_1',
  versions: [version(1, 'published', { createdBy: REVIEWER })],
})

const DRAFT = fixtureClient({
  documentId: 'doc_1',
  lifecycle: 'active',
  publishedVersionId: null,
  versions: [version(1, 'draft')],
})

function inReviewFixture(documentId: string): DocumentLifecycleClient {
  return fixtureClient({
    documentId,
    lifecycle: 'active',
    publishedVersionId: null,
    versions: [
      version(1, 'in_review', {
        submittedBy: AUTHOR,
        submittedAt: '2026-09-03T10:15:00.000Z',
      }),
    ],
  })
}

const IN_REVIEW = inReviewFixture('doc_2')
const DELEGATED = inReviewFixture('doc_4')

const PUBLISHED = fixtureClient({
  documentId: 'doc_3',
  lifecycle: 'active',
  publishedVersionId: 'ver_3',
  versions: [
    version(1, 'superseded', {
      submittedBy: AUTHOR,
      submittedAt: '2026-08-11T08:00:00.000Z',
      approvedBy: REVIEWER,
      approvedAt: '2026-08-11T14:20:00.000Z',
      publishedBy: REVIEWER,
      publishedAt: '2026-08-12T07:05:00.000Z',
    }),
    version(2, 'superseded', {
      submittedBy: AUTHOR,
      submittedAt: '2026-08-24T09:40:00.000Z',
      reviewComment:
        'Die Fluchtweglänge im 2. Obergeschoss fehlt, und Tabelle 3 nennt noch die alte Gebäudeklasse.',
      approvedBy: REVIEWER,
      approvedAt: '2026-08-25T11:00:00.000Z',
      publishedBy: REVIEWER,
      publishedAt: '2026-08-25T11:30:00.000Z',
    }),
    version(3, 'published', {
      submittedBy: AUTHOR,
      submittedAt: '2026-09-01T16:10:00.000Z',
      approvedBy: REVIEWER,
      approvedAt: '2026-09-02T08:25:00.000Z',
      publishedBy: REVIEWER,
      publishedAt: '2026-09-02T08:40:00.000Z',
    }),
  ],
})

const NAMES: Record<string, string> = { [AUTHOR]: 'Anna Berger', [REVIEWER]: 'Markus Feld' }

const TRACK_STATES: readonly { state: DocumentVersionState }[] = [
  { state: 'draft' },
  { state: 'in_review' },
  { state: 'changes_requested' },
  { state: 'approved' },
  { state: 'published' },
  { state: 'rejected' },
  { state: 'superseded' },
]

function devFile(id: string, filename: string, authoredBy: FileItem['authoredBy']): FileItem {
  return {
    id,
    filename,
    displayName: null,
    fileSize: 18_400,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-09-02T07:30:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
    authoredBy,
  }
}

const REVIEWER_VIEWER = {
  permissions: ['project:view', 'project:edit', 'project:documents:write'] as const,
  userId: REVIEWER,
}

export default function DocumentLifecycleDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const variant = use(searchParams).variant
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      {variant === 'archive' ? <ArchiveFixture /> : <DocumentLifecycleFixtures />}
    </I18nProvider>
  )
}

function ArchiveFixture(): JSX.Element {
  useDrivenBlocks()
  return (
    <main
      className="mx-auto flex max-w-3xl flex-col gap-6 p-6"
      data-testid="document-lifecycle-archive-preview"
    >
      <div>
        <h1 className="text-lg font-semibold">Stilllegen</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Der einzige Akt in diesem Abschnitt, der sich im Haus nicht zurücknehmen lässt — und
          deshalb der einzige, der vorher sagt, was er tut.
        </p>
      </div>
      <div className="rounded-xl border p-4" data-preview-block="archive">
        <DocumentRevisions
          file={devFile('doc_0', 'Aktenvermerk Fluchtwege.pdf', 'user')}
            canManage
          viewer={REVIEWER_VIEWER}
          names={NAMES}
          client={UPLOADED}
        />
      </div>
    </main>
  )
}

const opened = new Set<string>()

const OPEN_MARKS = { status: 'counted', open: 4, proposed: 2, onOpen: () => window.alert('Prüfansicht öffnen') } as const

type DriveStep = {
  click: string
  settled: string
  portal?: true
  clickPortal?: true
}

const DRIVEN_BLOCKS: readonly (readonly [block: string, steps: readonly DriveStep[]])[] = [
  [
    'in-review',
    [{ click: 'document-lifecycle-request_changes', settled: 'document-review-comment' }],
  ],
  [
    'approve-open-marks',
    [{ click: 'document-lifecycle-approve', settled: 'document-review-approve-open-marks' }],
  ],
  [
    'delegate',
    [
      { click: 'document-review-more', settled: 'document-lifecycle-delegate_revision', portal: true },
      { click: 'document-lifecycle-delegate_revision', settled: 'document-review-comment', clickPortal: true },
    ],
  ],
  ['published', [{ click: 'document-revisions-toggle', settled: 'revision-timeline-row' }]],
  [
    'archive',
    [
      { click: 'document-revisions-toggle', settled: 'document-lifecycle-archive' },
      {
        click: 'document-lifecycle-archive',
        settled: 'document-archive-consequences',
        portal: true,
      },
    ],
  ],
]

function useDrivenBlocks(): void {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    timer.current = setInterval(() => {
      for (const [block, steps] of DRIVEN_BLOCKS) {
        if (opened.has(block)) continue
        const scope = document.querySelector(`[data-preview-block="${block}"]`)
        if (!scope) continue
        const pending = steps.find(
          (step) =>
            !(step.portal ? document : scope).querySelector(`[data-testid="${step.settled}"]`),
        )
        if (!pending) {
          opened.add(block)
          continue
        }
        const control = (pending.clickPortal ? document : scope).querySelector<HTMLElement>(
          `[data-testid="${pending.click}"]`,
        )
        control?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        control?.click()
      }
      if (opened.size === DRIVEN_BLOCKS.length && timer.current) {
        clearInterval(timer.current)
      }
    }, 120)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])
}

function DocumentLifecycleFixtures(): JSX.Element {
  useDrivenBlocks()

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-6" data-testid="document-lifecycle-preview">
      <div>
        <h1 className="text-lg font-semibold">Fassungen und Freigabe</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Der Stand einer Datei, die Entscheidungen, die dieser Stand zulässt, und die
          Fassungsgeschichte darunter.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Zustände</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-4">
          {DOCUMENT_VERSION_STATES.map((state) => (
            <DocumentVersionStateBadge key={state} versionState={state} always />
          ))}
          <DocumentVersionStateBadge lifecycle="archived" versionState="published" always />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Strecke</h2>
        <p className="text-muted-foreground max-w-prose text-xs">
          Jeder Zustand auf derselben Strecke. Farbe bekommt sie erst, wenn etwas geschehen ist:
          Ein Entwurf und eine laufende Prüfung bleiben Tinte, ab „Freigegeben“ wird die Strecke
          grün, und die beiden, die anhalten — „Änderungen erbeten“ steht wieder beim Entwurf,
          „Abgelehnt“ nach der Prüfung —, sind rot und zusätzlich gestrichelt.
        </p>
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
          {TRACK_STATES.map(({ state }) => (
            <DocumentLifecyclePosition
              key={state}
              version={{ state }}
              lifecycle="active"
              live={state === 'in_review'}
            />
          ))}
          {/* Item-level, so it is not a stage: the whole track reads as history. */}
          <DocumentLifecyclePosition
            version={{ state: 'published' }}
            lifecycle="archived"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          In Ruhe — eine hochgeladene Datei
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs">
          Der Normalfall: Jemand hat die Datei hochgelegt, damit ist sie behauptet, und es steht
          nichts zur Entscheidung. Zugeklappt sagt der Abschnitt das Wort, die Strecke und einen
          Satz — Fassungen, Entscheidungen und das Stilllegen liegen dahinter.
        </p>
        <div className="rounded-xl border p-4">
          <DocumentRevisions
            file={devFile('doc_0', 'Aktenvermerk Fluchtwege.pdf', 'user')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={UPLOADED}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Entwurf</h2>
        <div className="rounded-xl border p-4">
          <DocumentRevisions
            file={devFile('doc_1', 'Bericht.md', 'agent')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={DRAFT}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">In Prüfung</h2>
        <div className="rounded-xl border p-4" data-preview-block="in-review">
          <DocumentRevisions
            file={devFile('doc_2', 'Bericht.md', 'agent')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={IN_REVIEW}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Freigeben — mit offenen Anmerkungen
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs">
          Vor der Unterschrift steht, was auf den Seiten noch offen ist, mit dem Weg in die
          Prüfansicht. Es hält die Freigabe nicht auf: Ob ein offener Punkt ihr im Weg steht,
          entscheidet, wer freigibt.
        </p>
        <div className="rounded-xl border p-4" data-preview-block="approve-open-marks">
          <DocumentRevisions
            file={devFile('doc_5', 'Einreichplan_Grundriss_EG.pdf', 'user')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={IN_REVIEW}
            openMarks={OPEN_MARKS}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Zurückgeben — und {PRODUCT_NAME} überarbeiten lassen
        </h2>
        <div className="rounded-xl border p-4" data-preview-block="delegate">
          <DocumentRevisions
            file={devFile('doc_4', 'Bericht.md', 'agent')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={DELEGATED}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Veröffentlicht — aufgeklappt
        </h2>
        <div className="rounded-xl border p-4" data-preview-block="published">
          <DocumentRevisions
            file={devFile('doc_3', 'Bericht.md', 'user')}
            canManage
            viewer={REVIEWER_VIEWER}
            names={NAMES}
            client={PUBLISHED}
          />
        </div>
      </section>
    </main>
  )
}
