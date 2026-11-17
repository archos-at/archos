'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { FolderUploadDialog } from '@/features/documents/components/folder-upload-dialog'
import {
  buildFolderUploadPlan,
  type RevisionChoice,
  type FolderUploadPlan,
} from '@/features/documents/lib/folder-upload-plan'
import type { RevisionChange } from '@/features/documents/lib/revision-proposals'
import type { RevisionCandidateMatch } from '@/lib/documents/name-probe-types'
import type { FileItem, FolderItem } from '@/features/documents/components/project-file-workspace'

function pathed(relativePath: string, size: number): File {
  const name = relativePath.split('/').pop()!
  const file = new File(['x'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true })
  Object.defineProperty(file, 'size', { value: size, configurable: true })
  return file
}

function doc(filename: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    id: `doc-${filename}`,
    filename,
    displayName: null,
    fileSize: 1_000,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    originPath: null,
    contentHash: null,
    createdAt: '2026-08-20T09:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
    assignees: [],
    authoredBy: 'user',
    ...extra,
  }
}

const IDENTICAL = `sha256:${'a'.repeat(64)}`

const FOLDERS: FolderItem[] = [
  { id: 'f-root', parentId: null, name: 'Wohnbau Nord', path: 'Wohnbau Nord' },
  { id: 'f-plaene', parentId: 'f-root', name: 'Pläne', path: 'Wohnbau Nord/Pläne' },
  { id: 'f-statik', parentId: 'f-root', name: 'Statik', path: 'Wohnbau Nord/Statik' },
]

function resyncPlan(): FolderUploadPlan {
  const unchanged = [
    pathed('Wohnbau Nord/Pläne/EG.pdf', 1_000),
    pathed('Wohnbau Nord/Pläne/OG.pdf', 1_000),
    pathed('Wohnbau Nord/Statik/Bewehrung.pdf', 1_000),
  ]
  const corrected = [
    pathed('Wohnbau Nord/Pläne/Schnitt_A.pdf', 2_400),
    pathed('Wohnbau Nord/Statik/Nachweis.pdf', 2_400),
  ]
  const fresh = [
    pathed('Wohnbau Nord/Pläne/Detail_Attika.pdf', 900),
    pathed('Wohnbau Nord/Brandschutz/Konzept.pdf', 900),
  ]

  return buildFolderUploadPlan({
    files: [...unchanged, ...corrected, ...fresh],
    folders: FOLDERS,
    currentFolderId: null,
    documents: [
      doc('EG.pdf', { fileSize: 1_000, contentHash: IDENTICAL, folderId: 'f-plaene' }),
      doc('OG.pdf', { fileSize: 1_000, contentHash: IDENTICAL, folderId: 'f-plaene' }),
      doc('Bewehrung.pdf', { fileSize: 1_000, contentHash: IDENTICAL, folderId: 'f-statik' }),
      doc('Schnitt_A.pdf', { fileSize: 2_400, contentHash: IDENTICAL, folderId: 'f-plaene' }),
      doc('Nachweis.pdf', { fileSize: 2_400, contentHash: IDENTICAL, folderId: null }),
    ],
    digests: new Map([
      ...unchanged.map((file) => [file, IDENTICAL] as const),
      ...corrected.map((file) => [file, `sha256:${'b'.repeat(64)}`] as const),
    ]),
  })
}

function firstPlan(): FolderUploadPlan {
  return buildFolderUploadPlan({
    files: [
      pathed('Wohnbau Nord/Pläne/EG.pdf', 1_000),
      pathed('Wohnbau Nord/Pläne/OG.pdf', 1_000),
      pathed('Wohnbau Nord/Statik/Nachweis.pdf', 1_000),
    ],
    documents: [],
    folders: [],
    currentFolderId: null,
  })
}

function collisionPlan(): FolderUploadPlan {
  return buildFolderUploadPlan({
    files: [
      pathed('Wohnbau Nord/Pläne/Deckblatt.pdf', 1_000),
      pathed('Wohnbau Nord/Statik/Deckblatt.pdf', 1_200),
      pathed('Wohnbau Nord/Pläne/EG.pdf', 1_000),
    ],
    documents: [],
    folders: FOLDERS,
    currentFolderId: null,
  })
}

function knownPlan(): FolderUploadPlan {
  const unchanged = pathed('Wohnbau Nord/Pläne/EG.pdf', 1_000)
  const renamed = pathed('Wohnbau Nord/Statik/Nachweis.pdf', 2_400)
  const otherCase = pathed('Wohnbau Nord/Pläne/DECKBLATT.pdf', 900)

  return buildFolderUploadPlan({
    files: [unchanged, renamed, otherCase],
    folders: FOLDERS,
    currentFolderId: null,
    documents: [
      doc('EG.pdf', { fileSize: 1_000, contentHash: IDENTICAL, folderId: null }),
      doc('Nachweis.pdf', {
        fileSize: 2_400,
        contentHash: IDENTICAL,
        folderId: 'f-statik',
        displayName: 'Statischer Nachweis — Freigabe 08/26',
      }),
      doc('Deckblatt.pdf', { fileSize: 900, folderId: 'f-plaene' }),
    ],
    digests: new Map([
      [unchanged, IDENTICAL],
      [renamed, `sha256:${'b'.repeat(64)}`],
    ]),
  })
}

function exportOffers(files: readonly File[]): Map<string, RevisionCandidateMatch> {
  const one = (name: string, held: string, label: string): RevisionCandidateMatch => ({
    name,
    candidates: [{ id: `doc-${held}`, filename: held, displayName: null, label }],
    newer: true,
    unambiguous: true,
  })
  const offers = new Map<string, RevisionCandidateMatch>()
  for (const file of files) {
    const sheet = /Blatt_(\d+)_Index_C/.exec(file.name)
    if (sheet) offers.set(file.name, one(file.name, `Blatt_${sheet[1]}_Index_B.pdf`, 'Index B · 02.07.2026'))
  }
  offers.set('Detail_Stiege_Index_C.pdf', {
    name: 'Detail_Stiege_Index_C.pdf',
    candidates: [
      { id: 'doc-stiege-b', filename: 'Detail_Stiege_Index_B.pdf', displayName: null, label: 'Index B' },
      { id: 'doc-stiege-a', filename: 'Detail_Stiege_Index_A.pdf', displayName: null, label: 'Index A' },
    ],
    newer: true,
    unambiguous: false,
  })
  offers.set('Schnitt_BB_Index_A.pdf', {
    name: 'Schnitt_BB_Index_A.pdf',
    candidates: [{ id: 'doc-bb-c', filename: 'Schnitt_BB_Index_C.pdf', displayName: null, label: 'Index C' }],
    newer: false,
    unambiguous: false,
  })
  return offers
}

interface OfferedDrop {
  files: File[]
  offers: Map<string, RevisionCandidateMatch>
  documents?: FileItem[]
  digests?: Map<File, string>
}

function exportDrop(): OfferedDrop {
  const files = [
    ...Array.from({ length: 12 }, (_, i) =>
      pathed(`Export/${i % 3 === 0 ? 'Schnitte' : 'Grundrisse'}/Blatt_${String(i).padStart(2, '0')}_Index_C.pdf`, 1_000 + i)
    ),
    pathed('Export/Details/Detail_Stiege_Index_C.pdf', 900),
    pathed('Export/Schnitte/Schnitt_BB_Index_A.pdf', 900),
  ]
  return { files, offers: exportOffers(files) }
}

function fortyDrop(): OfferedDrop {
  const root = 'Einreichung_2026-10'
  const folders = [
    ['01_Grundrisse', 'Grundriss_Erdgeschoss', 12],
    ['02_Schnitte', 'Schnitt_Laengsschnitt', 10],
    ['03_Ansichten', 'Ansicht_Nordfassade', 8],
    ['04_Details', 'Detail_Fensteranschluss', 4],
  ] as const
  const offers = new Map<string, RevisionCandidateMatch>()
  const sheets = folders.flatMap(([folder, title, count], f) =>
    Array.from({ length: count }, (_, i) => {
      const sheet = `${['EG', 'SN', 'AN', 'DT'][f]}-${100 + i * 4}_${title}`
      const name = `${sheet}_Index_C_2026-10-02.pdf`
      const held = `${sheet}_Index_B_2026-07-02.pdf`
      offers.set(name, {
        name,
        candidates: [{ id: `doc-${held}`, filename: held, displayName: null, label: 'Index B · 02.07.2026' }],
        newer: true,
        unambiguous: true,
      })
      return pathed(`${root}/${folder}/${name}`, 2_000 + i)
    })
  )
  const unclear = [
    pathed(`${root}/04_Details/Detail_Attika_Index_C.pdf`, 900),
    pathed(`${root}/04_Details/Detail_Stiege_Index_C.pdf`, 900),
    pathed(`${root}/02_Schnitte/Schnitt_BB_Index_A.pdf`, 900),
  ]
  offers.set('Detail_Attika_Index_C.pdf', {
    name: 'Detail_Attika_Index_C.pdf',
    candidates: [
      { id: 'doc-attika-b', filename: 'Detail_Attika_Index_B.pdf', displayName: 'Attika, Detail 1:10 (Freigabe)', label: 'Index B · 12.08.2026' },
      { id: 'doc-attika-b2', filename: 'Detail_Attika_Index_B2.pdf', displayName: null, label: 'Index B' },
    ],
    newer: true,
    unambiguous: false,
  })
  for (const [name, offer] of exportOffers(unclear)) offers.set(name, offer)
  const sameName = [pathed(`${root}/Baubeschreibung.pdf`, 3_000), pathed(`${root}/Deckblatt.pdf`, 3_000)]
  return {
    files: [...sheets, ...unclear, ...sameName, pathed(`${root}/Lageplan_Notiz.pdf`, 500)],
    offers,
    documents: [
      doc('Baubeschreibung.pdf', { fileSize: 3_000, contentHash: IDENTICAL }),
      doc('Deckblatt.pdf', { fileSize: 3_000, contentHash: IDENTICAL }),
    ],
    digests: new Map(sameName.map((file) => [file, `sha256:${'b'.repeat(64)}`] as const)),
  }
}

function soleDrop(variant: 'single-revision' | 'single-unclear' | 'single-older'): OfferedDrop {
  const name =
    variant === 'single-older' ? 'EG_Grundriss_Index_A_2026-05-02.pdf' : 'EG_Grundriss_Index_C_2026-10-02.pdf'
  const candidates =
    variant === 'single-unclear'
      ? [
          { id: 'doc-eg-b', filename: 'EG_Grundriss_Index_B_2026-07-02.pdf', displayName: null, label: 'Index B · 02.07.2026' },
          { id: 'doc-eg-b-alt', filename: 'EG_Grundriss_Variante_Index_B.pdf', displayName: 'Grundriss EG, Variante', label: 'Index B' },
        ]
      : [{ id: 'doc-eg-b', filename: 'EG_Grundriss_Index_B_2026-07-02.pdf', displayName: null, label: 'Index B · 02.07.2026' }]
  return {
    files: [pathed(name, 1_000)],
    offers: new Map([
      [name, { name, candidates, newer: variant !== 'single-older', unambiguous: variant === 'single-revision' }],
    ]),
  }
}

function OfferedPreview({ drop, kind }: { drop: () => OfferedDrop; kind: 'folder' | 'files' }): JSX.Element {
  const [built] = useState(drop)
  const [choices, setChoices] = useState<Map<File, RevisionChoice>>(new Map())
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const plan = useMemo(
    () =>
      buildFolderUploadPlan({
        files: built.files,
        folders: [],
        currentFolderId: null,
        documents: built.documents ?? [],
        digests: built.digests,
        revisionOffers: built.offers,
        revisionChoices: choices,
      }),
    [built, choices]
  )
  const change = ({ files: changed, chosen, targetId }: RevisionChange) =>
    setChoices((previous) => {
      const next = new Map(previous)
      for (const file of changed) next.set(file, { ...next.get(file), ...(targetId ? { targetId, chosen: chosen ?? true } : { chosen }) })
      return next
    })
  const confirm = () =>
    setConfirmed(
      plan.files.map((file) => `${file.file.name} → ${file.revisionOf?.chosen ? file.revisionOf.of.name : 'eigenes Dokument'}`).join('\n')
    )
  return (
    <>
      <FolderUploadDialog
        open={confirmed === null}
        onOpenChange={() => {}}
        plan={plan}
        currentFolderName={null}
        onConfirm={confirm}
        onRevisionChange={change}
        kind={kind}
      />
      {confirmed && (
        <pre className="mx-auto max-w-lg whitespace-pre-wrap font-mono text-xs" data-testid="folder-upload-preview-confirmed">
          {confirmed}
        </pre>
      )}
    </>
  )
}

export default function FolderUploadPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const variant = useSearchParams()?.get('variant') ?? 'resync'
  const plan =
    variant === 'planning'
      ? null
      : variant === 'first'
        ? firstPlan()
        : variant === 'collisions'
          ? collisionPlan()
          : variant === 'known'
            ? knownPlan()
            : resyncPlan()

  return (
    <main className="min-h-dvh bg-background px-4 py-10" data-testid="folder-upload-preview">
      <h1 className="mx-auto mb-6 max-w-lg font-mono text-xs text-muted-foreground">
        /dev/folder-upload — {variant}
      </h1>
      {variant === 'revisions' ? (
        <OfferedPreview drop={exportDrop} kind="folder" />
      ) : variant === 'revisions-40' ? (
        <OfferedPreview drop={fortyDrop} kind="folder" />
      ) : variant === 'single-revision' || variant === 'single-unclear' || variant === 'single-older' ? (
        <OfferedPreview key={variant} drop={() => soleDrop(variant)} kind="files" />
      ) : (
        <FolderUploadDialog
          open
          onOpenChange={() => {}}
          plan={plan}
          currentFolderName={null}
          onConfirm={() => {}}
        />
      )}
    </main>
  )
}
