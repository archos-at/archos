import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { EMPTY_REVISION_LINKS, type RevisionLinks, type RevisionRef } from '@/lib/documents/revision-links'
import type { DocumentLifecycleClient } from '@/lib/documents/lifecycle-client'
import type {
  DocumentVersionListResponse,
  DocumentVersionState,
  DocumentVersionView,
} from '@/lib/documents/lifecycle-types'
import type { FileItem } from '../file-types'
import { DocumentRevisions, type DocumentRevisionsProps } from './document-revisions'

export const copy = filesCopy.messages.de
export const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key]))

export const fileFixture = (overrides: Partial<FileItem> = {}): FileItem => ({
  id: 'doc_1',
  filename: 'Grundriss_C.pdf',
  displayName: null,
  fileSize: 1024,
  contentType: 'application/pdf',
  status: 'completed',
  folderId: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
  ...overrides,
})

export const facts = (overrides: Partial<RevisionLinks> = {}): RevisionLinks => ({ ...EMPTY_REVISION_LINKS, ...overrides })
export const ref = (id: string, filename: string): RevisionRef => ({ id, filename })
export const answer = (newer: RevisionLinks, older: RevisionLinks = EMPTY_REVISION_LINKS) => ({ newer, older })

export function makeVersion(
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
    fileSize: 1200,
    contentHash: 'sha256:abc',
    submittedBy: null,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    approvedBy: null,
    approvedAt: null,
    publishedBy: null,
    publishedAt: null,
    reviewComment: null,
    createdBy: 'user_author',
    createdAt: `2026-09-0${versionNumber}T08:00:00.000Z`,
    updatedAt: `2026-09-0${versionNumber}T08:00:00.000Z`,
    ...overrides,
  }
}

export const reviewed = (versionNumber: number, state: DocumentVersionState, overrides: Partial<DocumentVersionView> = {}) =>
  makeVersion(versionNumber, state, {
    submittedBy: 'user_author',
    submittedAt: `2026-09-0${versionNumber}T09:00:00.000Z`,
    ...overrides,
  })

const PEOPLE = [
  { userId: 'user_author', name: 'Anna Berger' },
  { userId: 'user_sabine', name: 'Sabine Gruber' },
  { userId: 'user_markus', name: 'Markus Feld' },
  { userId: 'user_clara', name: 'Clara Schmid' },
]

export function listing(
  versions: readonly DocumentVersionView[],
  overrides: Partial<DocumentVersionListResponse> = {},
): DocumentVersionListResponse {
  return {
    documentId: 'doc_1',
    lifecycle: 'active',
    publishedVersionId: versions.find((v) => v.state === 'published')?.id ?? null,
    versions: [...versions],
    people: PEOPLE,
    ...overrides,
  }
}

export function fakeClient(overrides: Partial<DocumentLifecycleClient> = {}): DocumentLifecycleClient {
  const unexpected = () => Promise.reject(new Error('not stubbed'))
  return {
    listVersions: unexpected,
    getVersion: unexpected,
    forkDraft: unexpected,
    replaceContent: unexpected,
    submit: unexpected,
    approve: unexpected,
    requestChanges: unexpected,
    reject: unexpected,
    publish: unexpected,
    archive: unexpected,
    diff: unexpected,
    ...overrides,
  } as DocumentLifecycleClient
}

export const clientOf = (
  versions: readonly DocumentVersionView[],
  overrides: Partial<DocumentLifecycleClient> = {},
  listed: Partial<DocumentVersionListResponse> = {},
) => fakeClient({ listVersions: () => Promise.resolve(listing(versions, listed)), ...overrides })

export const reviewer = { permissions: ['project:view', 'project:edit'] as const, userId: 'user_reviewer' }
export const viewOnly = { permissions: ['project:view'] as const, userId: 'user_x' }

export const section = (props: Partial<DocumentRevisionsProps> & { file?: FileItem }): ReactElement => (
  <I18nProvider initialLocale="de" fixedLocale>
    <DocumentRevisions file={props.file ?? fileFixture()} canManage={false} {...props} />
  </I18nProvider>
)

export const renderSection = (props: Parameters<typeof section>[0] = {}) => render(section(props))

export const toggle = () => screen.findByTestId('document-revisions-toggle')

export async function renderOpen(props: Parameters<typeof section>[0] = {}) {
  const result = render(section(props))
  const trigger = await toggle()
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger)
  return result
}

export async function openRowMenu(row: HTMLElement) {
  await userEvent.click(within(row).getByTestId('revision-row-menu'))
  return screen.findByRole('menu')
}
