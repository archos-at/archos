import { expect } from 'vitest'

import type { ProposedChangeRow } from '@/lib/db/schema/proposed-changes'
import type { ListedDocument } from '@/lib/documents/shelf-listing'
import type { ProjectFolderRow } from '@/lib/projects/folder-service'
import type { DirectoryPerson } from '@/lib/sharing/types'
import type { FileOperationPayload, MemoryPayload, ProjectProfilePayload } from '@/lib/proposals/types'

export const ID = '0b7c8f5e-1d1e-4c39-9d2c-3f0f6c1a2b3c'
export const PROJECT = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
export const CONVERSATION = 'conv_1'

export const MOVE: FileOperationPayload = {
  operation: 'move',
  operations: [
    { document: 'Grundriss EG.pdf', source: 'project', target_folder: 'Einreichung/Pläne' },
    { document: 'Schnitt A-A.pdf', source: 'project', target_folder: 'Einreichung/Pläne' },
  ],
}

export const row = (extra: Partial<ProposedChangeRow> = {}): ProposedChangeRow => ({
  id: ID,
  organizationId: 'org_1',
  projectId: PROJECT,
  scope: 'project',
  kind: 'file_operation',
  payload: MOVE,
  status: 'proposed',
  proposedByKind: 'piloti',
  onBehalfOf: 'user_2',
  originConversationId: CONVERSATION,
  originMessageId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
  originCardIndex: null,
  createdAt: new Date('2026-10-13T08:00:00Z'),
  decidedBy: null,
  decidedAt: null,
  results: null,
  applyingBy: null,
  applyingSince: null,
  originTraceId: null,
  ...extra,
})

export function assertChecks(stored: ProposedChangeRow): void {
  const decided = stored.status !== 'proposed'
  expect(decided, 'proposed_changes_decision_complete').toBe(stored.decidedBy !== null)
  expect(stored.decidedBy === null, 'proposed_changes_decision_complete').toBe(stored.decidedAt === null)
  expect(
    ['applied', 'partially_applied', 'failed'].includes(stored.status),
    'proposed_changes_results_when_applied'
  ).toBe(stored.results !== null)
  expect(stored.applyingBy === null, 'proposed_changes_claim_complete').toBe(stored.applyingSince === null)
  if (stored.applyingBy !== null) expect(stored.status, 'proposed_changes_claim_while_proposed').toBe('proposed')
}

export const undecided = (current: ProposedChangeRow | undefined, staleBefore: Date) =>
  current &&
  current.status === 'proposed' &&
  (current.applyingSince === null || current.applyingSince.getTime() < staleBefore.getTime())

export const person = (userId: string, name: string, email: string): DirectoryPerson => ({
  userId,
  name,
  email,
  profilePictureUrl: null,
})

export const listed = (id: string, filename: string, createdAt = '2026-10-01T08:00:00Z') =>
  ({ id, filename, createdAt: new Date(createdAt) }) as Partial<ListedDocument> as ListedDocument

export const folder = (id: string, path: string) =>
  ({ id, path, name: path.split('/').at(-1), parentId: null, projectId: PROJECT }) as Partial<ProjectFolderRow> as ProjectFolderRow

export const NOTE: MemoryPayload = {
  scope: 'project',
  kind: 'decision',
  content: 'Das Dach wird als extensiv begrüntes Flachdach ausgeführt, mit Attika und innenliegender Entwässerung über zwei Gullys',
  confidence: 'high',
  supersedes: 'Das Dach wird als Satteldach ausgeführt',
}

export const PROFILE: ProjectProfilePayload = {
  title: 'Bundesland: Tirol',
  rationale: 'Laut Lageplan liegt das Grundstück in Innsbruck.',
  patch: [{ op: 'replace', path: '/facts/federal_state/value', value: 'tirol' }],
}

export const memoryRow = (payload: Partial<MemoryPayload> = {}, extra: Partial<ProposedChangeRow> = {}) =>
  row({ kind: 'memory', payload: { ...NOTE, ...payload }, ...extra })
export const profileRow = (extra: Partial<ProposedChangeRow> = {}) => row({ kind: 'project_profile', payload: PROFILE, ...extra })
