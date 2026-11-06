'use client'

/**
 * Dev preview for the Papierkorb and everything around a deleted folder
 * (ADR-0088).
 *
 * The REAL `FolderBinPanel` over a fixture listing: one folder restorable,
 * one whose parent is gone (restores to the project root), one the reader may
 * only read (no restore), one being purged. Restore and „Endgültig löschen"
 * go through a module-scope fetch shim that answers as the server would, including the legal-hold refusal on
 * „Honorare". Below it: the organization setting „Inhalte aus gelöschten
 * Ordnern", and the „Quelle gelöscht am …" note as an answer, a memory note
 * and a filed report show it.
 *
 * Not linked from anywhere and 404s outside development.
 */

import { FIXTURE_NOW } from '../inbound-mail/fixture-base'
import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import type { FolderBinListing } from '@/adapters/api/folder-bin-client'
import { SourceDeletedNote } from '@/components/projects/source-deleted-note'
import { ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { primeInboundMailWaiting } from '@/hooks/use-inbound-mail-waiting'
import { FolderBinPanel } from '@/features/documents/components/folder-bin-panel'
import { DeletedFolderContentCard } from '@/features/organization/components/deleted-folder-content-card'

const PROJECT = 'dev-project'
// Relative to today, as the E-Mail-Eingang's fixture: a „bleibt bis“ already past read as a broken Papierkorb.
const BIN_DAYS = 14
const daysAgo = (days: number): string => new Date(FIXTURE_NOW - days * 86_400_000).toISOString()

const LISTING: FolderBinListing = {
  canPurge: true,
  nextCursor: null,
  entries: [
    {
      // One document sent to the bin on its own: restoring it files it back in „Pläne“.
      folderId: 'f-grundriss',
      name: 'Grundriss EG Index C.pdf',
      path: 'Pläne/Grundriss EG Index C.pdf',
      deletedAt: daysAgo(1),
      deletedBy: { userId: 'user_gf', name: 'Gerda Fischer' },
      purgeAfter: daysAgo(1 - BIN_DAYS),
      status: 'pending',
      documents: 1,
      folders: 1,
      canRestore: true,
      document: { id: 'd-grundriss', name: 'Grundriss EG Index C.pdf' },
    },
    {
      folderId: 'f-vertraege',
      name: 'Verträge',
      path: 'Verwaltung/Verträge',
      deletedAt: daysAgo(3),
      deletedBy: { userId: 'user_gf', name: 'Gerda Fischer' },
      purgeAfter: daysAgo(3 - BIN_DAYS),
      status: 'pending',
      documents: 14,
      folders: 2,
      canRestore: true,
      document: null,
    },
    {
      folderId: 'f-alt',
      name: 'Alt',
      path: 'Pläne/Alt',
      deletedAt: daysAgo(2),
      deletedBy: { userId: 'user_pl', name: 'Paul Lechner' },
      purgeAfter: daysAgo(2 - BIN_DAYS),
      status: 'pending',
      documents: 3,
      folders: 1,
      canRestore: true,
      document: null,
    },
    {
      folderId: 'f-honorare',
      name: 'Honorare',
      path: 'Honorare',
      deletedAt: daysAgo(7),
      deletedBy: { userId: null, name: null },
      purgeAfter: daysAgo(7 - BIN_DAYS),
      status: 'pending',
      documents: 6,
      folders: 0,
      canRestore: false,
      restoreBlocked: 'folder_read_only',
      document: null,
    },
    {
      folderId: 'f-statik',
      name: 'Statik-Vorabzug',
      path: 'Statik/Statik-Vorabzug',
      deletedAt: daysAgo(13),
      deletedBy: { userId: 'user_st', name: 'Sabine Thaler' },
      purgeAfter: daysAgo(13 - BIN_DAYS),
      status: 'purging',
      documents: 21,
      folders: 4,
      canRestore: false,
      document: null,
    },
  ],
}

const COUNTS = { documents: 14, folders: 3, memoryNotes: 0, answers: 0, conversations: 2, reports: 0, tracesErased: 0 }

const state = { entries: LISTING.entries.map((entry) => ({ ...entry })), policy: 'unchanged' }

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __folderBinShim?: boolean }
  if (!w.__folderBinShim) {
    w.__folderBinShim = true
    const real = window.fetch.bind(window)
    const pause = () => new Promise((resolve) => window.setTimeout(resolve, 350))
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === `/api/projects/${PROJECT}/bin`) return Response.json({ ...LISTING, entries: state.entries })
      const restore = /\/bin\/([^/]+)\/restore$/.exec(url)
      if (restore) {
        await pause()
        const folderId = decodeURIComponent(restore[1])
        state.entries = state.entries.filter((entry) => entry.folderId !== folderId)
        const restoredTo = folderId === 'f-alt' ? 'root' : 'original'
        return Response.json({ restoredTo, folders: 1, documents: 3 })
      }
      const held = Response.json(
        { error: 'This item is under a legal hold and cannot be deleted.', code: 'CONFLICT', details: { reason: 'legal_hold' } },
        { status: 409 }
      )
      const purge = /\/bin\/([^/]+)$/.exec(url)
      if (purge && init?.method === 'DELETE') {
        await pause()
        if (purge[1] === 'f-honorare') return held
        state.entries = state.entries.filter((entry) => entry.folderId !== decodeURIComponent(purge[1]))
        return Response.json({ status: 'purged', counts: COUNTS })
      }
      if (url === '/api/organization/deleted-folder-content') {
        if (init?.method === 'PUT') {
          await pause()
          state.policy = (JSON.parse(String(init.body)) as { policy: string }).policy
        }
        return Response.json({ policy: state.policy })
      }
      return real(input, init)
    }
  }
}

export default function BinDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  // The waiting count the rail would have read, for the E-Mail-Eingang tab.
  primeInboundMailWaiting(PROJECT, { count: 3, more: false })
  return (
    <main className="flex flex-col gap-10 pb-12" data-testid="bin-preview">
      {/* In the section frame, as the project's Papierkorb tab draws it: its head, its tabs, its container. */}
      <div className="h-dvh">
        <ProjectSectionFrame projectId={PROJECT} projectName="Wohnhaus Lend" pathname={`/app/projects/${PROJECT}/files/bin`} inboundMail>
          <div className="h-full overflow-y-auto">
            <FolderBinPanel projectId={PROJECT} initial={{ ...LISTING, entries: state.entries }} />
          </div>
        </ProjectSectionFrame>
      </div>
      <section className="flex flex-col gap-3 px-4 sm:px-6">
        <h2 className="text-sm font-semibold">Organisation → Sensible Daten → „Inhalte aus gelöschten Ordnern“</h2>
        <DeletedFolderContentCard canEdit />
      </section>
      <section className="flex flex-col gap-2 px-4 sm:px-6">
        <h2 className="text-sm font-semibold">„Quelle gelöscht am …“ unter abgeleiteten Inhalten</h2>
        <p className="text-sm">Laut Werkvertrag ist die Abnahme bis 30. November vorgesehen. [1]</p>
        <SourceDeletedNote at={daysAgo(3 - BIN_DAYS)} />
        <p className="mt-3 text-sm">Notiz: Honorarzone III vereinbart.</p>
        <SourceDeletedNote at={daysAgo(3 - BIN_DAYS)} />
      </section>
    </main>
  )
}
