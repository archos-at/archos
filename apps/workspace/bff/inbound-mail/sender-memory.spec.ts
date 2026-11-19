import { describe, expect, it } from 'vitest'
import { FILE_PART_ID, filePart, heldMail, textPart } from './__fixtures__/review'
import { dominantSenderFolder, modelSuggestion, senderMemoryAddress, senderMemoryFallback } from './sender-memory'

const FACADE = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d'
const STRUCTURE = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e'
const folder = (folderId: string, path: string, count: number) => ({ folderId, path, count })

describe('dominantSenderFolder', () => {
  it('is the folder with at least two earlier files and at least twice the next one', () => {
    expect(dominantSenderFolder([folder(STRUCTURE, 'Tragwerk', 1), folder(FACADE, 'Fassade', 3)])?.folderId).toBe(FACADE)
    expect(dominantSenderFolder([folder(FACADE, 'Fassade', 2)])?.folderId).toBe(FACADE)
    expect(dominantSenderFolder([folder(FACADE, 'Fassade', 4), folder(STRUCTURE, 'Tragwerk', 2)])?.folderId).toBe(FACADE)
  })

  it('is none when one earlier file is all there is, or another folder is close', () => {
    expect(dominantSenderFolder([])).toBeNull()
    expect(dominantSenderFolder([folder(FACADE, 'Fassade', 1)])).toBeNull()
    expect(dominantSenderFolder([folder(FACADE, 'Fassade', 3), folder(STRUCTURE, 'Tragwerk', 2)])).toBeNull()
    expect(dominantSenderFolder([folder(FACADE, 'Fassade', 2), folder(STRUCTURE, 'Tragwerk', 2)])).toBeNull()
  })
})

describe('senderMemoryFallback', () => {
  const folders = [folder(FACADE, 'Planung/Fassade', 3)]

  it('offers the dominant folder for an attachment the suggestion would place, marked as the sender’s memory', () => {
    const parts = [textPart(), filePart()]
    const fallback = senderMemoryFallback(parts, folders)
    expect(fallback(parts[1]!)).toEqual({
      folderId: FACADE,
      folderPath: 'Planung/Fassade',
      newFolder: false,
      documentType: null,
      reason: '',
      source: 'sender_memory',
    })
    expect(fallback(parts[0]!)).toBeNull()
  })

  it('offers nothing for an attachment no suggestion would place: infected, name-stopped, unnamed or no longer waiting', () => {
    for (const part of [
      filePart({ scanStatus: 'infected' }),
      filePart({ nameStopTerms: ['Gehalt'] }),
      filePart({ filename: null }),
      filePart({ state: 'filed' }),
      filePart({ riskFlags: ['type_not_accepted'] }),
    ]) {
      expect(senderMemoryFallback([part], folders)(part)).toBeNull()
    }
  })

  it('offers nothing without a dominant folder', () => {
    const part = filePart({ id: FILE_PART_ID })
    expect(senderMemoryFallback([part], [folder(FACADE, 'Fassade', 1)])(part)).toBeNull()
  })
})

describe('senderMemoryAddress', () => {
  it('is the lower-cased sender address of a waiting mail', () => {
    expect(senderMemoryAddress(heldMail({ senderAddress: ' P.Weber@Fassade-Weber.AT ', senderTrust: 'external_unverified', senderReason: 'dkim_none' }))).toBe(
      'p.weber@fassade-weber.at',
    )
  })

  it('is none for an impersonation, an automatic mail, a handled mail or a sender without an address', () => {
    expect(senderMemoryAddress(heldMail({ senderTrust: 'member_unverified', senderReason: 'dkim_fail' }))).toBeNull()
    expect(senderMemoryAddress(heldMail({ automatic: true }))).toBeNull()
    expect(senderMemoryAddress(heldMail({ status: 'settled' }))).toBeNull()
    expect(senderMemoryAddress(heldMail({ senderAddress: 'MAILER-DAEMON' }))).toBeNull()
  })
})

describe('modelSuggestion', () => {
  const stored = { folderId: FACADE, folderPath: 'Fassade', newFolder: false, documentType: null, reason: 'Fassadenpläne.' }

  it('is the agent’s suggestion, never the sender’s memory, so nothing files unseen into a remembered folder', () => {
    expect(modelSuggestion({ ...stored, source: 'model' })).toEqual({ ...stored, source: 'model' })
    expect(modelSuggestion(stored)).toEqual(stored)
    expect(modelSuggestion({ ...stored, reason: '', source: 'sender_memory' })).toBeNull()
    expect(modelSuggestion(null)).toBeNull()
  })
})
