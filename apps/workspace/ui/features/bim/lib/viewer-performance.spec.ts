/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  captureFrameOptions,
  CONTRIBUTION_CULL,
  interactiveFrameOptions,
  screenshotFilename,
} from './viewer-performance'

describe('the interactive frame', () => {
  it('culls sub-pixel batches and simplifies distant ones', () => {
    const options = interactiveFrameOptions()
    expect(options.contributionCull?.pixelRadius).toBeGreaterThan(0)
    expect(options.lod?.screenPx).toBeGreaterThan(0)
  })

  it('never culls LESS while the camera is moving than at rest', () => {
    expect(CONTRIBUTION_CULL.interactingPixelRadius ?? 0).toBeGreaterThanOrEqual(
      CONTRIBUTION_CULL.pixelRadius
    )
  })

  it('keeps LOD far more conservative than the cull', () => {
    expect(interactiveFrameOptions().lod?.screenPx ?? 0).toBeGreaterThan(
      CONTRIBUTION_CULL.pixelRadius
    )
  })
})

describe('the frame behind a screenshot', () => {
  it('turns every shortcut off', () => {
    const options = captureFrameOptions()
    expect(options.contributionCull).toBeUndefined()
    expect(options.lod).toBeUndefined()
  })

  it('rebuilds evicted geometry first', () => {
    expect(captureFrameOptions().restoreEvictedForCapture).toBe(true)
  })

  it('tells the renderer this frame is neither mid-gesture nor mid-load', () => {
    expect(captureFrameOptions().isInteracting).toBe(false)
    expect(captureFrameOptions().isStreaming).toBe(false)
  })
})

describe('what a captured view is called', () => {
  const when = new Date(2026, 7, 11, 9, 5, 3)

  it('leads with the model, so the reader can find it by searching', () => {
    expect(screenshotFilename('Wohnhaus-Nord.ifc', when)).toBe('Wohnhaus-Nord-20260811-090503.png')
  })

  it('drops the IFC extension rather than burying it mid-name', () => {
    expect(screenshotFilename('haus.ifczip', when)).toContain('haus-')
    expect(screenshotFilename('haus.ifczip', when)).not.toContain('ifczip')
  })

  it('distinguishes four captures taken in one sitting', () => {
    const first = screenshotFilename('a.ifc', new Date(2026, 7, 11, 9, 5, 3))
    const second = screenshotFilename('a.ifc', new Date(2026, 7, 11, 9, 5, 41))
    expect(first).not.toBe(second)
  })

  it('keeps letters a filesystem and a reader can both handle', () => {
    expect(screenshotFilename('Grundriss OG/Rev 2.ifc', when)).toBe(
      'Grundriss-OG-Rev-2-20260811-090503.png'
    )
    expect(screenshotFilename('Bürogebäude.ifc', when)).toContain('Bürogebäude')
  })

  it('still produces a name when the model has none', () => {
    expect(screenshotFilename(null, when)).toBe('modell-20260811-090503.png')
    expect(screenshotFilename('///.ifc', when)).toBe('modell-20260811-090503.png')
  })
})
