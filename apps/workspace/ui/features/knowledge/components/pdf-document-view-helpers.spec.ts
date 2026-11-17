import { describe, expect, it } from 'vitest'
import { pointOnPage } from './pdf-document-view-helpers'

describe('pointOnPage', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 }

  it('is the share of the page the click hit, top-left origin', () => {
    expect(pointOnPage(3, rect, 60, 45)).toEqual({ page: 3, x: 0.25, y: 0.25 })
  })

  it('clamps a click on the page edge onto the page', () => {
    expect(pointOnPage(1, rect, 0, 500)).toEqual({ page: 1, x: 0, y: 1 })
  })

  it('has no point on a page with no size yet', () => {
    expect(pointOnPage(1, { ...rect, width: 0 }, 60, 45)).toBeNull()
  })
})
