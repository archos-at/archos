import { describe, expect, it } from 'vitest'
import { calibrationView } from '@/test-utils/calibration-sheet'
import { emptyDraft, pickPoint, proposalOf, regionPlace, withRegion, type CalibrationDraft } from './calibration-draft'

const PAGE = { width: 1190.55, height: 841.89 }
const FROM = { x: 0.25, y: 0.5 }
const TO = { x: 0.75, y: 0.5 }
const BOX = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }

const twoPoints = (): CalibrationDraft => pickPoint(pickPoint(emptyDraft(1), 1, FROM), 1, TO)

describe('picking the reference points', () => {
  it('takes the first click as the first point and the second as the second', () => {
    const first = pickPoint(emptyDraft(2), 2, FROM)
    expect(first).toMatchObject({ page: 2, from: FROM, to: null, region: null })
    expect(pickPoint(first, 2, TO)).toMatchObject({ page: 2, from: FROM, to: TO })
  })

  it('starts over on the page of a click elsewhere, since a reference length lies on one page', () => {
    expect(pickPoint(twoPoints(), 3, { x: 0.1, y: 0.1 })).toMatchObject({ page: 3, from: { x: 0.1, y: 0.1 }, to: null })
  })

  it('keeps both points on a third click, and never takes the first point twice', () => {
    const both = twoPoints()
    expect(pickPoint(both, 1, { x: 0.9, y: 0.9 })).toBe(both)
    const first = pickPoint(emptyDraft(1), 1, FROM)
    expect(pickPoint(first, 1, FROM)).toBe(first)
  })

  it('keeps a drawn box on the page and ignores one drawn on another page', () => {
    const draft = twoPoints()
    expect(withRegion(draft, 2, BOX)).toBe(draft)
    expect(withRegion(draft, 1, { x: 0.7, y: 0.8, w: 0.5, h: 0.5 }).region).toEqual({ x: 0.7, y: 0.8, w: 0.3, h: 0.2 })
  })
})

describe('what a draft amounts to', () => {
  it('asks for the points, then the frame, in the order a person meets them', () => {
    expect(proposalOf(null, null, PAGE, []).blocked).toBe('firstPoint')
    expect(proposalOf(emptyDraft(1), 21, PAGE, []).blocked).toBe('firstPoint')
    expect(proposalOf(pickPoint(emptyDraft(1), 1, FROM), 21, PAGE, []).blocked).toBe('secondPoint')
  })

  it('shows 1:100 for two points half a 1190.55 pt page apart and 21 m, before there is a frame', () => {
    expect(proposalOf(twoPoints(), 21, PAGE, [])).toMatchObject({ ratio: '1:100', blocked: 'region', request: null })
  })

  it('shows no ratio while the page size is unknown', () => {
    expect(proposalOf(withRegion(twoPoints(), 1, BOX), 21, null, []).ratio).toBeNull()
  })

  it('sends shares of the page once the frame holds both points and the length is there', () => {
    const proposal = proposalOf(withRegion(twoPoints(), 1, BOX), 21, PAGE, [])
    expect(proposal).toMatchObject({ blocked: null, ratio: '1:100', replaces: null })
    expect(proposal.request).toEqual({ page: 1, region: BOX, from: FROM, to: TO, lengthM: 21 })
  })

  it('refuses a frame that misses a point, and asks for the length last', () => {
    expect(proposalOf(withRegion(twoPoints(), 1, { x: 0.3, y: 0.3, w: 0.2, h: 0.4 }), 21, PAGE, []).blocked).toBe('regionMisses')
    expect(proposalOf(withRegion(twoPoints(), 1, BOX), null, PAGE, [])).toMatchObject({ blocked: 'length', request: null })
  })

  it('refuses a frame that partly overlaps an active scale of the page, before anything is sent', () => {
    const other = calibrationView({ region: { x: 0.5, y: 0.1, w: 0.45, h: 0.4 } })
    const proposal = proposalOf(withRegion(twoPoints(), 1, BOX), 21, PAGE, [other])
    expect(proposal).toMatchObject({ blocked: 'overlaps', overlaps: other, request: null })
    expect(proposalOf(withRegion(twoPoints(), 1, BOX), 21, PAGE, [{ ...other, page: 2 }]).blocked).toBeNull()
  })

  it('allows a frame wholly inside or around another, and says which one an equal frame replaces', () => {
    const around = calibrationView({ region: { x: 0, y: 0, w: 1, h: 1 } })
    const inside = calibrationView({ id: '55555555-5555-4555-8555-555555555555', region: { x: 0.3, y: 0.35, w: 0.1, h: 0.1 } })
    expect(proposalOf(withRegion(twoPoints(), 1, BOX), 21, PAGE, [around, inside])).toMatchObject({ blocked: null, replaces: null })
    const same = calibrationView({ region: BOX })
    expect(proposalOf(withRegion(twoPoints(), 1, BOX), 21, PAGE, [same])).toMatchObject({ blocked: null, replaces: same })
  })
})

describe('where a frame lies, in words', () => {
  it('names the whole page and the nine places of a sheet', () => {
    expect(regionPlace({ x: 0, y: 0, w: 1, h: 0.95 })).toBe('page')
    expect(regionPlace({ x: 0.05, y: 0.05, w: 0.2, h: 0.2 })).toBe('topLeft')
    expect(regionPlace({ x: 0.7, y: 0.75, w: 0.25, h: 0.2 })).toBe('bottomRight')
    expect(regionPlace({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 })).toBe('centre')
  })
})
