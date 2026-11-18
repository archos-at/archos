import { vi, type Mock } from 'vitest'
import { aiProvenanceMarking } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { GENERATED_DOCUMENT_FOLDER_NAME, type FileGeneratedDocumentInput, type GeneratedRenderContext } from './generated'

export const SESSION = {
  userId: 'user-1',
  email: 'architektin@example.at',
  name: 'Architektin',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'editor',
  permissions: ['project:documents:write'],
  featureFlags: null,
} as AuthorizedSession

export const FOLDER = {
  id: 'folder-1',
  projectId: 'proj-1',
  parentId: null,
  name: GENERATED_DOCUMENT_FOLDER_NAME,
  path: GENERATED_DOCUMENT_FOLDER_NAME,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
}

export const renderedBytes = (marking: string) => new TextEncoder().encode(`report ${marking}`)

export const render = vi.fn((context: GeneratedRenderContext) => ({
  bytes: renderedBytes(context.marking),
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  marking: context.marking,
}))

export const REPORT_MARKING = aiProvenanceMarking({ runId: 'run_7' })

export const filingInput = (overrides: Partial<FileGeneratedDocumentInput> = {}): FileGeneratedDocumentInput => ({
  session: SESSION,
  projectId: 'proj-1',
  producer: 'deep_research',
  ref: 'run_7',
  title: 'Brandschutz Straßenhäuser',
  render,
  ...overrides,
})

export const sentCommands = <T>(send: Mock, kind: abstract new (...args: never[]) => T): T[] =>
  send.mock.calls
    .map(([command]) => command as unknown)
    .filter((command): command is T => command instanceof kind)
