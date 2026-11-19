import { describe, expect, it } from 'vitest'
import { mail, messagePart, part, suggestion, thread } from '@/app/dev/inbound-mail/fixture-builders'
import { filePart, FOLDER_ID, textPart } from './__fixtures__/review'
import { followAttachmentDecisions } from './follow-filing'
import type { InboundMailPartView, InboundMailView } from './inbound-mail-wire'

const existing = (folderPath = 'Tragwerk') => ({ ...suggestion(folderPath, 'Grundriss', 'Wie S-101_C.'), folderId: FOLDER_ID })
const EARLIER = { documentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'S-101_C.pdf', folderPath: 'Tragwerk', nextVersion: 4 }

function reply(attachments: InboundMailPartView[], overrides: Partial<InboundMailView> = {}): InboundMailView {
  return mail({ parts: [messagePart(), ...attachments], threadCandidates: [thread()], ...overrides })
}

function rowsOf(view: InboundMailView, rowOverrides: Record<string, Parameters<typeof filePart>[0]> = {}) {
  return view.parts.map((shown) =>
    shown.kind === 'message'
      ? textPart({ id: shown.id })
      : filePart({ id: shown.id, filename: shown.filename, scanStatus: shown.scan, riskFlags: shown.riskFlags, ...rowOverrides[shown.filename ?? ''] }),
  )
}

const decided = (view: InboundMailView, rowOverrides: Record<string, Parameters<typeof filePart>[0]> = {}) =>
  followAttachmentDecisions(view, rowsOf(view, rowOverrides)).map((decision) => decision.name)

describe('which attachments a follow files with the reply', () => {
  it('files a clean attachment whose suggestion names a folder that exists, into that folder, with its type', () => {
    const view = reply([part({ name: 'S-102.pdf', suggestion: existing() })])
    const [decision] = followAttachmentDecisions(view, rowsOf(view))
    expect(decision).toEqual({
      partId: view.parts[1]!.id,
      folderId: FOLDER_ID,
      newFolderPath: null,
      name: 'S-102.pdf',
      documentType: 'Grundriss',
    })
  })

  it('leaves an attachment with no suggestion waiting', () => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: null })]))).toEqual([])
  })

  it('leaves an attachment waiting whose suggestion is a folder a convention would create', () => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: suggestion('Tragwerk/Index D', 'Grundriss', 'Konvention', { newFolder: true }) })]))).toEqual([])
  })

  it('leaves an attachment waiting whose folder is only where this sender’s earlier attachments went: that is for a person’s review', () => {
    const memory = { ...existing(), documentType: null, reason: '', source: 'sender_memory' as const }
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: memory })]))).toEqual([])
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: { ...existing(), source: 'model' } })]))).toEqual(['S-102.pdf'])
  })

  it('leaves an attachment waiting whose suggestion names a folder by path alone', () => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: suggestion('Tragwerk', 'Grundriss', 'Pfad') })]))).toEqual([])
  })

  it.each([
    ['a macro', { riskFlags: ['macro'] as const }],
    ['a type mismatch', { riskFlags: ['type_mismatch'] as const }],
    ['an encrypted file', { riskFlags: ['encrypted'] as const }],
  ])('leaves an attachment flagged with %s waiting', (_name, flags) => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: existing(), riskFlags: [...flags.riskFlags] })]))).toEqual([])
  })

  it('leaves an attachment flagged on its row since the view was read waiting', () => {
    const view = reply([part({ name: 'S-102.pdf', suggestion: existing() })])
    expect(decided(view, { 'S-102.pdf': { riskFlags: ['name_stop'] } })).toEqual([])
    expect(decided(view, { 'S-102.pdf': { contentFindings: ['iban'] } })).toEqual([])
  })

  it.each([
    ['still being scanned', 'pending'],
    ['whose scan failed', 'failed'],
    ['found infected', 'infected'],
  ] as const)('leaves an attachment %s waiting', (_name, scan) => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: existing(), scan })]))).toEqual([])
  })

  it('files a revision the review defaults vouch for in this Verlauf as the next Fassung of its document', () => {
    const view = reply([part({ name: 'S-101_D.pdf', suggestion: existing(), revisionCandidate: EARLIER })])
    const [decision] = followAttachmentDecisions(view, rowsOf(view))
    expect(decision).toMatchObject({ name: 'S-101_D.pdf', revisionOf: EARLIER.documentId, folderId: null, newFolderPath: null })
  })

  it('leaves a revision waiting that the defaults would not pre-select for this sender', () => {
    const blocked = reply([part({ name: 'S-101_D.pdf', suggestion: existing(), revisionCandidate: EARLIER })], {
      threadCandidates: [thread({ blocks: ['sender_domain_new'], preselected: false })],
    })
    expect(decided(blocked)).toEqual([])
    const unverified = reply([part({ name: 'S-101_D.pdf', suggestion: existing(), revisionCandidate: EARLIER })], {
      sender: { name: 'P. Weber', address: 'p.weber@statik-weber.at', domain: 'statik-weber.at', signerDomain: null, trust: 'external_unverified', reason: 'dkim_none', flags: [] },
    })
    expect(decided(unverified)).toEqual([])
  })

  it('leaves an attachment waiting whose name matches a document the follower cannot see', () => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: existing(), revisionCandidateHidden: true })]))).toEqual([])
  })

  it('leaves a duplicate waiting', () => {
    expect(decided(reply([part({ name: 'S-102.pdf', suggestion: existing(), duplicateOf: { documentId: EARLIER.documentId, name: 'S-102.pdf', folderPath: 'Tragwerk' } })]))).toEqual([])
  })

  it('files each attachment on its own: the confident ones go, the rest wait', () => {
    const view = reply([
      part({ name: 'S-102.pdf', suggestion: existing() }),
      part({ name: 'Rechnung.docm', suggestion: existing('Rechnungen'), riskFlags: ['macro'] }),
      part({ name: 'Foto.pdf', suggestion: null }),
      part({ name: 'S-103.pdf', suggestion: existing('Tragwerk') }),
    ])
    expect(decided(view)).toEqual(['S-102.pdf', 'S-103.pdf'])
  })
})
