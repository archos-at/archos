import { describe, expect, it } from 'vitest'
import { offsetInContent, pointOnPage } from './pdf-document-view-helpers'

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

describe('offsetInContent', () => {
  const content = (box: { left: number; top: number; width: number }, layoutWidth: number): HTMLElement =>
    ({
      offsetWidth: layoutWidth,
      getBoundingClientRect: () => ({ ...box, height: 0, right: 0, bottom: 0, x: box.left, y: box.top }),
    }) as unknown as HTMLElement

  it('is the plain distance from the content edge when nothing is scaled', () => {
    expect(offsetInContent({ left: 510, top: 320 }, content({ left: 10, top: 20, width: 1000 }, 1000))).toEqual({ x: 500, y: 300 })
  })

  it('measures in the unscaled stack while a zoom still settles', () => {
    expect(offsetInContent({ left: 410, top: 260 }, content({ left: 10, top: 20, width: 800 }, 1000))).toEqual({ x: 500, y: 300 })
  })

  it('treats content with no layout width as unscaled', () => {
    expect(offsetInContent({ left: 60, top: 70 }, content({ left: 10, top: 20, width: 0 }, 0))).toEqual({ x: 50, y: 50 })
  })
})
