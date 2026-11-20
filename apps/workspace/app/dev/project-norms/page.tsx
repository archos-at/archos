'use client'

import { useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'
import { SectionLabel } from '@/components/ui/section-label'
import { ProjectNormNotices } from '@/features/documents/components/project-norm-notices'
import { InboxItemRow } from '@/features/collaboration/components/InboxItemRow'
import type { InboxNormDecisionClient } from '@/features/collaboration/components/InboxNormSuggestionDecision'
import type { InboxItemView } from '@/lib/inbox/types'
import type { NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { PlaceProjectNormsBody, ProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'
import type { ProposalResponse } from '@/lib/proposals/types'

const PROJECT = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const reference = {
  folderId: null,
  placedAs: 'moved' as const,
  createdAt: '2026-11-19T10:00:00Z',
  createdBy: 'user_anna',
}

function norms(canManageOfficeShelf: boolean): ProjectNormsResponse {
  return {
    canManageOfficeShelf,
    canWrite: true,
    offers: [
      { documentId: 'n1', fileName: 'OENORM_B_3691_2019.pdf', folderId: null, designation: 'ÖNORM B 3691', kind: 'technical_standard', editionLabel: '2019' },
      { documentId: 'n2', fileName: 'OENORM_B_2320.pdf', folderId: null, designation: 'ÖNORM B 2320', kind: 'technical_standard', editionLabel: null },
    ],
    references: [
      { ...reference, id: 'r1', fileName: 'OENORM_B_1600_2017.pdf', state: 'in_office_shelf', officeDocumentId: 'o1', entryId: 'edition_oenorm-b-1600' },
      { ...reference, id: 'r3', fileName: 'OENORM_B_5371_2021.pdf', state: 'unlisted', officeDocumentId: 'o3', entryId: null },
      { ...reference, id: 'r2', fileName: 'Weisung_MA37_Stellplaetze.pdf', state: 'removed', officeDocumentId: null, entryId: null },
    ],
    nextCursor: null,
  }
}

const NOBODY_DECIDES = { managers: ['Bernd Huber', 'Clara Novak'] }

function fakeNorms(canManageOfficeShelf: boolean, deciders = true): NormsFetch {
  let listed = norms(canManageOfficeShelf)
  return async (_path, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as PlaceProjectNormsBody
      const undecided = body.destination === 'suggest' && !deciders
      if (!undecided) listed = { ...listed, offers: [] }
      return Response.json({
        destination: body.destination,
        visibility: body.destination === 'project' ? 'project' : 'office',
        placements: [],
        notified: undecided ? 0 : 1,
        noDecider: undecided ? NOBODY_DECIDES : null,
      })
    }
    return Response.json(listed)
  }
}

const UPLOADED: ReadonlySet<string> = new Set(['n1', 'n2'])

function AfterUpload({ canManageOfficeShelf, deciders = true }: { canManageOfficeShelf: boolean; deciders?: boolean }): JSX.Element {
  const [run, setRun] = useState<NormsFetch | null>(null)
  return (
    <div className="grid gap-2">
      <Button type="button" variant="secondary" className="justify-self-start" onClick={() => setRun(() => fakeNorms(canManageOfficeShelf, deciders))}>
        Normen hochladen
      </Button>
      {run && <ProjectNormNotices projectId={PROJECT} folderId={null} run={run} awaiting={UPLOADED} />}
    </div>
  )
}

const suggestion: InboxItemView = {
  id: 'i-norm',
  type: 'office_shelf.norm_suggested',
  state: 'unread',
  archived: false,
  read: false,
  actionable: true,
  resourceType: 'project',
  resourceId: PROJECT,
  anchorId: '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c',
  actorName: 'Anna Berger',
  actorUserId: 'user_anna',
  count: 1,
  href: `/app/projects/${PROJECT}/files`,
  subject: 'Wohnhaus Floridsdorf',
  related: null,
  excerpt: 'ÖNORM B 3691',
  mentions: [],
  variant: null,
  answerIn: null,
  createdAt: '2026-11-19T09:00:00Z',
  updatedAt: '2026-11-19T09:00:00Z',
}

const decided = (status: 'applied' | 'dismissed') => ({ proposal: { status, results: [] } }) as unknown as ProposalResponse
const suggestedNorms = {
  proposal: {
    kind: 'office_shelf_norm',
    status: 'proposed',
    payload: {
      documents: [
        { id: 'n1', name: 'OENORM_B_3691_2019.pdf', designation: 'ÖNORM B 3691', kind: 'technical_standard', editionLabel: '2019-11-15' },
      ],
    },
  },
} as unknown as ProposalResponse

const decisions: InboxNormDecisionClient = {
  read: async () => suggestedNorms,
  apply: async () => decided('applied'),
  dismiss: async () => decided('dismissed'),
}

export default function ProjectNormsPreview(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <NormDialogProvider dialog={NormDialog}>
          <main className="mx-auto grid max-w-3xl gap-8 p-4 md:p-8">
            <section className="grid gap-2">
              <SectionLabel>Dateien · darf die Büroablage verwalten</SectionLabel>
              <ProjectNormNotices projectId={PROJECT} folderId={null} run={fakeNorms(true)} />
            </section>
            <section className="grid gap-2">
              <SectionLabel>Dateien · darf nur vorschlagen</SectionLabel>
              <ProjectNormNotices projectId={PROJECT} folderId={null} run={fakeNorms(false)} />
            </section>
            <section className="grid gap-2">
              <SectionLabel>Nach dem Hochladen · darf die Büroablage verwalten</SectionLabel>
              <AfterUpload canManageOfficeShelf />
            </section>
            <section className="grid gap-2">
              <SectionLabel>Nach dem Hochladen · darf nur vorschlagen</SectionLabel>
              <AfterUpload canManageOfficeShelf={false} />
            </section>
            <section className="grid gap-2">
              <SectionLabel>Vorschlagen · niemand darf hier entscheiden</SectionLabel>
              <ProjectNormNotices projectId={PROJECT} folderId={null} run={fakeNorms(false, false)} />
            </section>
            <section className="grid gap-2">
              <SectionLabel>Postfach</SectionLabel>
              <ul className="grid gap-1">
                <InboxItemRow item={suggestion} normDecisionClient={decisions} />
              </ul>
            </section>
          </main>
        </NormDialogProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}
