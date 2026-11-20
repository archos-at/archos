/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({}))
vi.mock('@/lib/authz/folder-access', () => ({}))
vi.mock('@/lib/authz/projects', () => ({}))
vi.mock('@/lib/inbound-mail/access', () => ({}))

import { attachmentViews } from './service'
import type { EntryAttachment } from './repository'

const HIDDEN = '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c'
const attachment = (overrides: Partial<EntryAttachment>): EntryAttachment => ({
  entryId: 'e',
  position: 1,
  filename: 'S-101_C.pdf',
  disposition: 'filed',
  notFiledReason: null,
  documentId: 'doc-1',
  documentVersionId: null,
  document: { folderId: null, folderPath: '' },
  ...overrides,
})

describe('an entry’s attachments for the reader', () => {
  it('names what the reader may open, and never what was not filed (review D, finding 3)', () => {
    expect(
      attachmentViews(
        [attachment({}), attachment({ position: 2, filename: 'Plan.dwg', disposition: 'not_filed', notFiledReason: 'type_not_accepted', documentId: null, document: null })],
        new Set(),
      ),
    ).toEqual([
      { position: 1, filename: 'S-101_C.pdf', disposition: 'filed', documentId: 'doc-1', folderPath: '', visible: true },
      { position: 2, filename: null, disposition: 'not_filed', notFiledReason: 'type_not_accepted', visible: true },
    ])
  })

  it('says the folder a filed attachment lies in now, for one the reader may open', () => {
    expect(
      attachmentViews(
        [
          attachment({ document: { folderId: 'f-statik', folderPath: 'Tragwerk/Statik' } }),
          attachment({ position: 2, disposition: 'already_present', document: { folderId: 'f-plaene', folderPath: 'Pläne' } }),
        ],
        new Set(),
      ),
    ).toEqual([
      expect.objectContaining({ position: 1, folderPath: 'Tragwerk/Statik' }),
      expect.objectContaining({ position: 2, folderPath: 'Pläne' }),
    ])
  })

  it('keeps the place of one filed where the reader may not look, without its name or ids', () => {
    expect(attachmentViews([attachment({ document: { folderId: HIDDEN, folderPath: 'Vertraulich' } })], new Set([HIDDEN]))).toEqual([
      { position: 1, filename: null, disposition: 'filed', visible: false },
    ])
  })

  it('hides a filed attachment whose document is gone, held or binned', () => {
    expect(attachmentViews([attachment({ document: null })], new Set())).toEqual([{ position: 1, filename: null, disposition: 'filed', visible: false }])
  })
})
