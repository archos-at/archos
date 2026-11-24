import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { StoredAction } from '@/lib/conversations/message-provenance'
import {
  basisLine,
  labelPoint,
  measuredValue,
  measureStepPlace,
  pointsInMark,
  shapeBox,
} from './measure-steps'

const t = translatorFor(chatCopy, 'de')

const action = (extra: Partial<StoredAction> = {}): StoredAction => ({
  verb: 'measure',
  status: 'ok',
  target: 'Grundriss EG.pdf',
  documentId: 'doc-1',
  pages: '3',
  measure: {
    quantity: 'clearance',
    points: [
      [0.3, 0.5],
      [0.3, 0.56],
    ],
    value: 1.2,
    unit: 'm',
    basis: 'estimated',
    ratio: 100,
  },
  ...extra,
})

describe('measureStepPlace', () => {
  test('opens the page at the box round the shape, padded where the shape is a vertical line', () => {
    const measured = measureStepPlace(action())!
    expect(measured.place).toMatchObject({
      document: { id: 'doc-1', name: 'Grundriss EG.pdf', shelf: 'stored' },
      page: 3,
      frame: 'page',
    })
    const [x0, y0, x1, y1] = measured.box
    expect(x1 - x0).toBeCloseTo(0.02)
    expect([y0, y1]).toEqual([0.5, 0.56])
    expect(x0).toBeCloseTo(0.29)
  })

  test('nothing to draw without a shape or a document the person can open', () => {
    expect(measureStepPlace(action({ measure: undefined }))).toBeNull()
    expect(measureStepPlace(action({ documentId: undefined }))).toBeNull()
    expect(measureStepPlace(action({ verb: 'model' }))).toBeNull()
  })
})

describe('the shape on the clip', () => {
  test('a box at the page edge stays on the page', () => {
    expect(
      shapeBox([
        [0, 0.999],
        [0, 1],
      ])
    ).toEqual([0, 0.98, 0.02, 1])
  })

  test('points map from the page into the mark the clip drew', () => {
    const mapped = pointsInMark(
      [0.2, 0.2, 0.4, 0.6],
      [0.25, 0.1, 0.75, 0.9],
      [
        [0.2, 0.2],
        [0.4, 0.6],
        [0.3, 0.4],
      ]
    )
    expect(mapped.flat().map((share) => Number(share.toFixed(6)))).toEqual([
      0.25, 0.1, 0.75, 0.9, 0.5, 0.5,
    ])
  })

  test('the label sits halfway along a line or a path, and in the middle of an area', () => {
    expect(
      labelPoint('distance', [
        [0, 0],
        [1, 0],
      ])
    ).toEqual([0.5, 0])
    expect(
      labelPoint('path', [
        [0, 0],
        [0.2, 0],
        [0.2, 0.6],
      ])
    ).toEqual([0.2, 0.2])
    expect(
      labelPoint('area', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ])
    ).toEqual([0.5, 0.5])
  })
})

describe('the value and its basis', () => {
  test('a length and an area in the reader’s numbers', () => {
    expect(measuredValue(action().measure!, 'de')).toBe('1,20 m')
    expect(measuredValue({ ...action().measure!, unit: 'm2', value: 12.345 }, 'en')).toBe(
      '12.35 m²'
    )
  })

  test('the basis says whose scale it is, or that a dimension figure was read', () => {
    const shape = action().measure!
    expect(basisLine(t, shape, 'de')).toBe('Maßstab 1:100, geschätzt')
    expect(basisLine(t, { ...shape, basis: 'confirmed' }, 'de')).toBe('Maßstab 1:100, bestätigt')
    expect(basisLine(t, { ...shape, basis: 'confirmed', ratio: undefined }, 'de')).toBe(
      'Maßstab bestätigt'
    )
    expect(basisLine(t, { ...shape, basis: 'printed', ratio: undefined }, 'de')).toBe(
      'aus einer Maßzahl abgelesen'
    )
  })
})
