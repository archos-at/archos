'use client'

import type { MissingDocument } from '@/lib/document-roles/prompt-loader'

import type { JSX, ReactNode } from 'react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { FolderBrief } from '@/features/documents/components/folder-brief'
import { FolderCard } from '@/features/documents/components/folder-navigation'
import { FolderRow } from '@/features/documents/components/folder-table-row'
import { FileListView } from '@/features/documents/components/file-list-view'
import {
  buildFolderBrief,
  buildFolderBriefFromSummary,
  readStateOf,
  subtreeTallies,
} from '@/features/documents/lib/folder-knowledge'
import type { FileItem } from '@/features/documents/file-types'
import type { ShelfFolderTally, ShelfSummary } from '@/lib/documents/shelf-summary-types'
import { withoutOlderRevisions } from '@/features/documents/lib/revision-chain'
import type { BulkReingestProgress } from '@/features/documents/hooks/use-bulk-reingest'
import { FILES, FOLDERS, PROJECT_NAME } from './fixtures'
import { SectionLabel } from '@/components/ui/section-label'

const SECTIONS = ['a', 'b', 'c', 'd', 'h', 'e', 'f', 'g'] as const
type SectionId = (typeof SECTIONS)[number]

const ROOT_BRIEF = buildFolderBrief(FILES, FOLDERS, null)
const SUBMISSION_BRIEF = buildFolderBrief(FILES, FOLDERS, 'f-03')
const BASIS_BRIEF = buildFolderBrief(FILES, FOLDERS, 'f-01')
const LISTED = withoutOlderRevisions(FILES, false)
const TALLIES = subtreeTallies(LISTED, FOLDERS)
const ROOT_FOLDERS = FOLDERS.filter((folder) => folder.parentId === null)

function summaryOf(files: readonly FileItem[]): ShelfSummary {
  const rows = new Map<string | null, ShelfFolderTally>()
  for (const file of files) {
    const key = file.folderId ?? null
    const row: ShelfFolderTally = rows.get(key) ?? {
      folderId: key,
      total: 0,
      readable: 0,
      reading: 0,
      failed: 0,
      held: 0,
      unindexed: 0,
      latest: null,
    }
    row.total += 1
    row[readStateOf(file.status)] += 1
    if (row.latest === null || file.createdAt > row.latest) row.latest = file.createdAt
    rows.set(key, row)
  }
  const failed = files.filter((file) => readStateOf(file.status) === 'failed')
  return {
    folders: [...rows.values()],
    failed: failed.map((file) => ({ id: file.id, folderId: file.folderId ?? null })),
    failedTruncated: false,
  }
}
const SUMMARY_BRIEF = buildFolderBriefFromSummary(summaryOf(FILES), FOLDERS, null)
const QUIET_BRIEF = buildFolderBriefFromSummary(
  {
    folders: [{ folderId: null, total: 43, readable: 27, reading: 0, failed: 0, held: 0, unindexed: 16, latest: null }],
    failed: [],
    failedTruncated: false,
  },
  FOLDERS,
  null
)

const noop = (): void => {}
const resolveFalse = (): Promise<boolean> => Promise.resolve(false)

const READ_AGAIN_TICK_MS = 450

function LiveRootBrief(): JSX.Element {
  const [collapsed, setCollapsed] = useState(true)
  const [progress, setProgress] = useState<BulkReingestProgress | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current)
    },
    []
  )

  const onReadAgain = (): void => {
    if (timer.current !== null) return
    const total = ROOT_BRIEF.attention.failed.length
    let done = 0
    let failed = 0
    setProgress({ total, done, failed })
    timer.current = setInterval(() => {
      done += 1
      if (done % 4 === 0) failed += 1
      if (done < total) {
        setProgress({ total, done, failed })
        return
      }
      if (timer.current !== null) clearInterval(timer.current)
      timer.current = null
      setProgress(null)
    }, READ_AGAIN_TICK_MS)
  }

  return (
    <FolderBrief
      brief={ROOT_BRIEF}
      folderName={null}
      shelfKind="project"
      onSelect={noop}
      onOpenFolder={noop}
      onReadAgain={onReadAgain}
      readAgainProgress={progress}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      missing={MISSING}
    />
  )
}

const MISSING: readonly MissingDocument[] = [
  { role: 'land_register_extract', label: 'Grundbuchauszug', buildingName: null },
  { role: 'expert_report_ground', label: 'Baugrundgutachten', buildingName: null },
  { role: 'existing_plans', label: 'Bestandspläne', buildingName: 'Hoftrakt' },
]

function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3" data-testid={`section-${id}`} aria-labelledby={`section-${id}-title`}>
      <SectionLabel as="h2" id={`section-${id}-title`}>
        {title}
      </SectionLabel>
      {children}
    </section>
  )
}

function itemCountOf(folderId: string): number {
  const documents = LISTED.filter((file) => file.folderId === folderId).length
  const subfolders = FOLDERS.filter((folder) => folder.parentId === folderId).length
  return documents + subfolders
}

function FolderTiles(): JSX.Element {
  const tileProps = (folder: (typeof ROOT_FOLDERS)[number]) => ({
    folder,
    itemCount: itemCountOf(folder.id),
    lastModified: TALLIES.get(folder.id)?.latest ?? null,
    knowledge: TALLIES.get(folder.id),
    onOpen: noop,
    onRenameFolder: resolveFalse,
    onDeleteFolder: resolveFalse,
  })
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {ROOT_FOLDERS.map((folder) => (
          <FolderCard key={folder.id} {...tileProps(folder)} />
        ))}
      </div>
      <FileListView
        files={[]}
        selectedFileId={null}
        onSelectFile={noop}
        folderRows={ROOT_FOLDERS.map((folder) => (
          <FolderRow key={folder.id} {...tileProps(folder)} />
        ))}
      />
    </div>
  )
}

function FolderBriefPreview(): JSX.Element {
  const requested = useSearchParams()?.get('section')
  const only = SECTIONS.find((id) => id === requested) ?? null
  const shows = (id: SectionId): boolean => only === null || only === id

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6">
        {only === null && (
          <header className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">Dev-Vorschau · {PROJECT_NAME}</p>
            <h1 className="text-foreground text-xl font-semibold">Ordner-Überblick</h1>
          </header>
        )}

        {shows('a') && (
          <Section id="a" title="Root (project)">
            <LiveRootBrief />
          </Section>
        )}

        {shows('b') && (
          <Section id="b" title="Folder 03_Einreichung">
            <FolderBrief
              brief={SUBMISSION_BRIEF}
              folderName="03_Einreichung"
              shelfKind="project"
              onSelect={noop}
              onOpenFolder={noop}
              onReadAgain={noop}
              collapsed={false}
              onCollapsedChange={noop}
            />
          </Section>
        )}

        {shows('c') && (
          <Section id="c" title="Collapsed">
            <FolderBrief
              brief={ROOT_BRIEF}
              folderName={null}
              shelfKind="project"
              onSelect={noop}
              onOpenFolder={noop}
              onReadAgain={noop}
              collapsed
              onCollapsedChange={noop}
            />
          </Section>
        )}

        {shows('d') && (
          <Section id="d" title="Everything read (a desk only: on a phone a brief with nothing to act on is not drawn)">
            <FolderBrief
              brief={BASIS_BRIEF}
              folderName="01_Grundlagen"
              shelfKind="project"
              onSelect={noop}
              onOpenFolder={noop}
              collapsed={false}
              onCollapsedChange={noop}
            />
          </Section>
        )}

        {shows('h') && (
          <Section id="h" title="Everything read, beside documents never read (the quiet case; a desk only, as above)">
            <FolderBrief
              brief={QUIET_BRIEF}
              folderName={null}
              shelfKind="office"
              onSelect={noop}
              onOpenFolder={noop}
              collapsed={false}
              onCollapsedChange={noop}
            />
          </Section>
        )}

        {shows('e') && (
          <Section id="e" title="Office shelf root">
            {/* No re-read here: the office shelf is shown to readers who may not write to it. */}
            <FolderBrief
              brief={ROOT_BRIEF}
              folderName={null}
              shelfKind="office"
              onSelect={noop}
              onOpenFolder={noop}
              collapsed={false}
              onCollapsedChange={noop}
            />
          </Section>
        )}

        {shows('g') && (
          <Section id="g" title="A folder read page by page (counts from the server, details on request)">
            <FolderBrief
              brief={SUMMARY_BRIEF}
              folderName={null}
              shelfKind="office"
              onSelect={noop}
              onOpenFolder={noop}
              onReadAgain={noop}
              collapsed={false}
              onCollapsedChange={noop}
              onLoadDetails={noop}
            />
          </Section>
        )}

        {shows('f') && (
          <Section id="f" title="Folder tiles (card view) and rows (list view)">
            <FolderTiles />
          </Section>
        )}
      </div>
    </main>
  )
}

export default function FolderBriefDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <Suspense fallback={<div />}>
      <FolderBriefPreview />
    </Suspense>
  )
}
