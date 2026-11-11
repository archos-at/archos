import { describe, expect, it } from 'vitest'
import { pickPoint, proposalOf, withDrawnRegion, withLength, type CalibrationDraft } from './calibration-draft'

/** A page half of whose width is 210 mm of paper. */
const PAGE = { width: 1190.55, height: 841.89 }
const FROM = { x: 0.25, y: 0.5 }
const TO = { x: 0.75, y: 0.5 }

const twoPoints = (): CalibrationDraft => pickPoint(pickPoint(null, 1, FROM, PAGE), 1, TO, PAGE)

describe('picking the reference points', () => {
  it('takes the first click as the first point and the second as the second', () => {
    const first = pickPoint(null, 2, FROM, PAGE)
    expect(first).toMatchObject({ page: 2, from: FROM, to: null, drawn: null })
    expect(pickPoint(first, 2, TO, PAGE)).toMatchObject({ page: 2, from: FROM, to: TO })
  })

  it('starts over on the page of a click elsewhere: a reference length lies on one page', () => {
    const elsewhere = pickPoint(twoPoints(), 3, { x: 0.1, y: 0.1 }, PAGE)
    expect(elsewhere).toMatchObject({ page: 3, from: { x: 0.1, y: 0.1 }, to: null, drawn: null })
  })

  it('keeps both points on a third click, and never takes the first point twice', () => {
    const both = twoPoints()
    expect(pickPoint(both, 1, { x: 0.9, y: 0.9 }, PAGE)).toBe(both)
    const first = pickPoint(null, 1, FROM, PAGE)
    expect(pickPoint(first, 1, FROM, PAGE)).toBe(first)
  })
})

describe('what a draft amounts to', () => {
  it('shows 1:100 for two points half a 1190.55 pt page apart and 21.0 m, before there is a region', () => {
    const proposal = proposalOf(withLength(twoPoints(), 21))
    expect(proposal.ratio).toBe('1:100')
    expect(proposal).toMatchObject({ blocked: 'region', region: null, request: null })
  })

  it('asks for the second point first', () => {
    expect(proposalOf(null).blocked).toBe('secondPoint')
    expect(proposalOf(pickPoint(null, 1, FROM, PAGE)).blocked).toBe('secondPoint')
  })

  it('takes the stored region when both points lie in it, and nothing needs drawing', () => {
    const stored = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }
    const proposal = proposalOf(withLength(twoPoints(), 21), { 1: [stored] })
    expect(proposal).toMatchObject({ region: stored, regionSource: 'stored', blocked: null })
    expect(proposal.request).toEqual({ page: 1, region: stored, from: FROM, to: TO, lengthM: 21 })
  })

  it('prefers the stored region to a box drawn before', () => {
    const stored = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }
    const drawn = withDrawnRegion(withLength(twoPoints(), 21), 1, { x: 0.2, y: 0.3, w: 0.6, h: 0.4 })
    expect(proposalOf(drawn, { 1: [stored] })).toMatchObject({ region: stored, regionSource: 'stored' })
  })

  it('must have the region drawn when no stored region holds both points', () => {
    const left = { x: 0, y: 0, w: 0.5, h: 1 }
    const right = { x: 0.5, y: 0, w: 0.5, h: 1 }
    const draft = withLength(pickPoint(pickPoint(null, 1, FROM, PAGE), 1, { x: 0.8, y: 0.5 }, PAGE), 21)
    expect(proposalOf(draft, { 1: [left, right] })).toMatchObject({ blocked: 'region', request: null })
    // Another page's regions are not this page's.
    expect(proposalOf(withLength(twoPoints(), 21), { 2: [{ x: 0, y: 0, w: 1, h: 1 }] }).blocked).toBe('region')
  })

  it('accepts a drawn region that holds both points, and sends shares of the page', () => {
    const box = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }
    const proposal = proposalOf(withDrawnRegion(withLength(twoPoints(), 21), 1, box))
    expect(proposal).toMatchObject({ region: box, regionSource: 'drawn', blocked: null, ratio: '1:100' })
    expect(proposal.request).toEqual({ page: 1, region: box, from: FROM, to: TO, lengthM: 21 })
  })

  it('refuses a drawn region that misses a point', () => {
    const proposal = proposalOf(withDrawnRegion(withLength(twoPoints(), 21), 1, { x: 0.3, y: 0.3, w: 0.2, h: 0.4 }))
    expect(proposal).toMatchObject({ region: null, blocked: 'regionMisses', request: null })
  })

  it('asks for the length last', () => {
    const drawn = withDrawnRegion(twoPoints(), 1, { x: 0.2, y: 0.3, w: 0.6, h: 0.4 })
    expect(proposalOf(drawn)).toMatchObject({ blocked: 'length', ratio: null, request: null })
    expect(proposalOf(withLength(drawn, 0)).blocked).toBe('length')
  })

  it('keeps a drawn box on the page and ignores one drawn on another page', () => {
    const draft = twoPoints()
    expect(withDrawnRegion(draft, 2, { x: 0.2, y: 0.3, w: 0.6, h: 0.4 })).toBe(draft)
    expect(withDrawnRegion(draft, 1, { x: 0.7, y: 0.8, w: 0.5, h: 0.5 }).drawn).toEqual({ x: 0.7, y: 0.8, w: 0.3, h: 0.2 })
  })
})
