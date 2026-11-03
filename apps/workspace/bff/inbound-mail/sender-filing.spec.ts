/**
 * What a verified writer's direct filing files, and where (`./sender-filing.ts`):
 * what the review offers that member checked, minus anything a person weighs,
 * and nothing without a confident place.
 */
import { describe, expect, it } from 'vitest'
import { DOCUMENT_ID, FILE_PART_ID, filePart, FOLDER_ID, MAIL_ID, PROJECT_ID, TEXT_PART_ID, textPart, THREAD_ID } from './__fixtures__/review'
import type { InboundMailPartView, InboundMailThreadCandidateView, InboundMailView } from './inbound-mail-wire'
import { senderDecision, withoutPart } from './sender-filing'
import type { InboundMailSuggestion } from './suggest'

const SUGGESTED: InboundMailSuggestion = { folderId: FOLDER_ID, folderPath: 'Statik', newFolder: false, documentType: null, reason: 'Statik' }

function partView(overrides: Partial<InboundMailPartView>): InboundMailPartView {
  return {
    id: FILE_PART_ID,
    kind: 'attachment',
    position: 1,
    filename: 'S-101_C.pdf',
    contentType: 'application/pdf',
    sizeBytes: 10,
    state: 'waiting',
    scan: 'clean',
    scannedAt: null,
    riskFlags: [],
    nameStopTerms: [],
    contentFindings: [],
    offered: true,
    lastFailure: null,
    documentId: null,
    filedAs: null,
    duplicateOf: null,
    revisionCandidate: null,
    revisionCandidateHidden: false,
    suggestion: SUGGESTED,
    preselected: true,
    restorableUntil: null,
    ...overrides,
  }
}

const textView = (overrides: Partial<InboundMailPartView> = {}) =>
  partView({ id: TEXT_PART_ID, kind: 'message', position: 0, filename: null, scan: 'not_applicable', suggestion: null, ...overrides })

const candidate: InboundMailThreadCandidateView = {
  threadId: THREAD_ID,
  documentId: DOCUMENT_ID,
  name: 'Statik Einreichung',
  folderPath: 'Korrespondenz',
  nextVersion: 3,
  strength: 'reference',
  preselected: true,
  blocks: [],
  full: false,
}

function view(parts: InboundMailPartView[], overrides: Partial<InboundMailView> = {}): InboundMailView {
  return {
    id: MAIL_ID,
    projectId: PROJECT_ID,
    status: 'waiting',
    projectClosed: false,
    ifMatch: 'if-1',
    subject: 'AW: Statik Einreichung',
    sender: { name: 'Anna', address: 'anna@buero.at', domain: 'buero.at', signerDomain: 'buero.at', trust: 'member_verified', reason: 'dkim_pass', flags: [] },
    participants: [],
    sentAt: null,
    receivedAt: '2026-11-03T08:00:00.000Z',
    expiresAt: '2026-12-03T08:00:00.000Z',
    automatic: false,
    rawScan: 'clean',
    originalHeld: true,
    notStaged: [],
    parts,
    threadCandidates: [],
    hiddenThreadCandidates: 0,
    followedBy: null,
    needsSenderAcknowledgement: false,
    incompleteReason: null,
    updatedAt: '2026-11-03T08:00:00.000Z',
    riskLevel: 'none',
    impersonation: null,
    senderClass: 'verified_writer',
    waitReason: null,
    onlySenderReleases: false,
    ...overrides,
  }
}

const rows = [textPart(), filePart()]

describe('senderDecision', () => {
  it('appends the text to the pre-selected Verlauf and files the attachment into the suggested folder', () => {
    expect(senderDecision(view([textView(), partView({})], { threadCandidates: [candidate] }), rows, null)).toEqual({
      mailId: MAIL_ID,
      ifMatch: 'if-1',
      parts: [{ partId: FILE_PART_ID, folderId: FOLDER_ID, newFolderPath: null, name: 'S-101_C.pdf', documentType: undefined }],
      message: { partId: TEXT_PART_ID, text: 'full', thread: { action: 'append', mailThreadId: THREAD_ID } },
    })
  })

  it('starts a Verlauf named after the subject, in the correspondence folder the member may write, else the root', () => {
    const correspondence = senderDecision(view([textView()]), [textPart()], { folderId: FOLDER_ID })
    expect(correspondence?.message?.thread).toEqual({ action: 'create', folderId: FOLDER_ID, newFolderPath: null, name: expect.stringContaining('Statik Einreichung') })
    expect(senderDecision(view([textView()]), [textPart()], null)?.message?.thread).toMatchObject({ folderId: null, newFolderPath: null })
  })

  it('files an attachment as the next Fassung of its earlier document when the sender vouches for it', () => {
    const revision = { documentId: DOCUMENT_ID, name: 'S-101_B.pdf', folderPath: 'Statik', nextVersion: 2 } as InboundMailPartView['revisionCandidate']
    const decision = senderDecision(view([partView({ revisionCandidate: revision })]), rows, null)
    expect(decision?.parts).toEqual([expect.objectContaining({ partId: FILE_PART_ID, revisionOf: DOCUMENT_ID })])
  })

  it('files attachments without a suggestion where the text goes: the text’s suggested folder, else correspondence, else the root', () => {
    // The agent's suggestion is off, out of budget or failed: nothing is suggested for any part.
    const unsuggested = partView({ suggestion: null })
    expect(senderDecision(view([textView(), unsuggested]), rows, { folderId: FOLDER_ID })?.parts).toEqual([
      { partId: FILE_PART_ID, folderId: FOLDER_ID, newFolderPath: null, name: 'S-101_C.pdf', documentType: undefined },
    ])
    expect(senderDecision(view([unsuggested]), rows, null)?.parts).toEqual([
      { partId: FILE_PART_ID, folderId: null, newFolderPath: null, name: 'S-101_C.pdf', documentType: undefined },
    ])
    const textSuggested = textView({ suggestion: { ...SUGGESTED, folderId: null, folderPath: 'Korrespondenz/Statik', newFolder: true } })
    expect(senderDecision(view([textSuggested, unsuggested]), rows, { folderId: FOLDER_ID })?.parts).toEqual([
      expect.objectContaining({ partId: FILE_PART_ID, folderId: null, newFolderPath: 'Korrespondenz/Statik' }),
    ])
    // The risk-flag and name checks hold without a suggestion too.
    expect(senderDecision(view([unsuggested]), [textPart(), filePart({ riskFlags: ['encrypted'] })], null)).toBeNull()
    expect(senderDecision(view([partView({ suggestion: null, filename: null })]), rows, null)).toBeNull()
  })

  it('leaves for the member what has a flag, a finding, no name, or was not offered checked', () => {
    expect(senderDecision(view([partView({})]), [textPart(), filePart({ riskFlags: ['encrypted'] })], null)).toBeNull()
    expect(senderDecision(view([partView({ filename: null })]), rows, null)).toBeNull()
    expect(senderDecision(view([partView({ preselected: false })]), rows, null)).toBeNull()
    expect(senderDecision(view([textView()]), [textPart({ contentFindings: ['iban'] })], null)).toBeNull()
    expect(senderDecision(view([textView()], { subject: null }), [textPart()], null)).toBeNull()
  })

  it('drops one refused part and keeps the rest', () => {
    const decision = senderDecision(view([textView(), partView({})], { threadCandidates: [candidate] }), rows, null)!
    expect(withoutPart(decision, FILE_PART_ID)).toMatchObject({ parts: [], message: { partId: TEXT_PART_ID } })
    expect(withoutPart(withoutPart(decision, FILE_PART_ID)!, TEXT_PART_ID)).toBeNull()
  })
})
