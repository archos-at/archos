import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { NORM_COVERS, normCoverFile, type NormCover } from '@/app/dev/_fixtures/norm-covers'
import { readCoverText } from '@/lib/pdf/cover-text'
import type { StoredEntry } from '../store/repository'
import { proposalReading, readCover } from './cover-page'
import { editionReplaced } from './listing'
import { recognizeNorm } from './reading'
import { editionsByWork, editionsOf } from './work-editions'

async function coverOf(cover: NormCover) {
  const text = await readCoverText(normCoverFile(cover))
  return text ? readCover(text) : null
}

const fileDesignation = (fileName: string) => {
  const reading = recognizeNorm({ fileName })
  return reading.norm ? reading.designation : null
}

describe('what a norm’s cover page says', () => {
  it('reads an ÖNORM’s designation, title, edition and every edition it replaces', async () => {
    expect(await coverOf(NORM_COVERS.onorm)).toEqual({
      designation: 'ÖNORM B 1600',
      title: 'Barrierefreies Bauen - Planungsgrundlagen',
      edition: { label: '2023-02-01', issuedOn: '2023-02-01' },
      replaces: [
        { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
        { designation: 'ÖNORM B 1601', editionLabel: '2003-02-01' },
      ],
    })
  })

  it('reads a European standard’s month of issue under its multilingual masthead', async () => {
    expect(await coverOf(NORM_COVERS.en)).toEqual({
      designation: 'EN 1990',
      title: 'Eurocode - Basis of structural design',
      edition: { label: '2002-04', issuedOn: null },
      replaces: [],
    })
  })

  it('reads a directive’s subject and the day it was signed', async () => {
    expect(await coverOf(NORM_COVERS.directive)).toEqual({
      designation: null,
      title: 'Dachgeschossausbau in Bestandsgebäuden',
      edition: { label: '2024-03-15', issuedOn: '2024-03-15' },
      replaces: [],
    })
  })

  it.each([
    ['Ausgabedatum: 2018-01', { label: '2018-01', issuedOn: null }],
    ['Datum: 15.03.2024', { label: '2024-03-15', issuedOn: '2024-03-15' }],
    ['Ausgabe 1. Jänner 2019', { label: '2019-01-01', issuedOn: '2019-01-01' }],
  ])('reads the edition from “%s”', (line, edition) => {
    expect(readCover(`DIN 4109-1\n${line}\nSchallschutz im Hochbau - Teil 1`).edition).toEqual(edition)
  })

  it('reads a cover image’s following page instead', async () => {
    expect((await coverOf(NORM_COVERS.imageCover))?.edition).toEqual({ label: '2023-02-01', issuedOn: '2023-02-01' })
  })

  it('has nothing to say about a scan without text', async () => {
    expect(await coverOf(NORM_COVERS.scan)).toBeNull()
  })
})

describe('what the proposal takes from the cover and from the file name', () => {
  it('prefers the cover, and remembers that it disagreed with the file name', async () => {
    const { fileName } = NORM_COVERS.disagrees
    const read = proposalReading(fileName, fileDesignation(fileName), await coverOf(NORM_COVERS.disagrees))

    expect(read.values).toEqual({
      designation: 'ÖNORM B 1600',
      editionLabel: '2023-02-01',
      issuedOn: '2023-02-01',
      title: 'Barrierefreies Bauen - Planungsgrundlagen',
    })
    expect(read.cover).toEqual({
      read: { designation: 'cover', editionLabel: 'cover', title: 'cover' },
      overrode: [{ field: 'editionLabel', fileName: '2017-04-01' }],
      replaces: [
        { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
        { designation: 'ÖNORM B 1601', editionLabel: '2003-02-01' },
      ],
    })
  })

  it('names a disagreeing designation, but not one the file name only spaced differently', () => {
    const cover = { designation: 'ÖNORM B 1600', title: null, edition: null, replaces: [] }

    expect(proposalReading('OENORM_B1600.pdf', 'ÖNORM B1600', cover).cover?.overrode).toEqual([])
    expect(proposalReading('OENORM_B_1601.pdf', 'ÖNORM B 1601', cover).cover?.overrode).toEqual([{ field: 'designation', fileName: 'ÖNORM B 1601' }])
  })

  it('keeps the file name’s day when the cover gives only its month', () => {
    const cover = { designation: 'DIN 4109-1', title: null, edition: { label: '2018-01', issuedOn: null }, replaces: [] }
    const read = proposalReading('DIN_4109-1_2018-01-15.pdf', 'DIN 4109-1', cover)

    expect(read.values).toEqual({ designation: 'DIN 4109-1' })
    expect(read.cover).toMatchObject({ read: { editionLabel: 'file_name' }, overrode: [] })
  })

  it('falls back to the file name, silently, when the cover has no text', async () => {
    const { fileName } = NORM_COVERS.scan
    const read = proposalReading(fileName, fileDesignation(fileName), await coverOf(NORM_COVERS.scan))

    expect(read).toEqual({ values: { designation: 'ÖNORM B 1300' }, cover: null })
  })
})

describe('the edition a cover replaces', () => {
  const B1600_2017 = {
    workId: 'work_b1600',
    editionId: 'edition_b1600_2017',
    documentId: 'doc-2017',
    confirmed: true,
    createdAt: new Date('2024-01-01'),
    values: { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01', issuedOn: '2017-04-01', inForceFrom: null, inForceTo: null },
  } as unknown as StoredEntry

  const confirmedNewEdition = (values: { editionLabel?: string; issuedOn?: string | null }) =>
    ({
      ...B1600_2017,
      editionId: 'edition_b1600_new',
      documentId: 'doc-new',
      createdAt: new Date('2026-11-19'),
      values: { ...B1600_2017.values, editionLabel: values.editionLabel ?? '2023', issuedOn: values.issuedOn ?? null },
    }) as StoredEntry

  const replacedOnceConfirmed = (fresh: StoredEntry) => {
    const works = editionsByWork([B1600_2017, fresh])
    return editionReplaced(editionsOf(B1600_2017, works, '2026-11-19'), B1600_2017.editionId)
  }

  it('shows the held copy as replaced once the new edition, dated by its cover, is confirmed', async () => {
    const fileName = 'OENORM_B_1600_2023.pdf'
    const { values } = proposalReading(fileName, fileDesignation(fileName), await coverOf(NORM_COVERS.onorm))

    expect(replacedOnceConfirmed(confirmedNewEdition(values))).toBe(true)
  })

  it('could not tell from the file name alone, which gives only the year', () => {
    expect(replacedOnceConfirmed(confirmedNewEdition({ editionLabel: '2023', issuedOn: null }))).toBe(false)
  })
})
