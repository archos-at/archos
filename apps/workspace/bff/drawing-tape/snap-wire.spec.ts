/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  fetchSnapTargets,
  SnapTargetsRequestError,
  snapTargetsPath,
  snapTargetsResponseSchema,
} from './snap-wire'

const TARGETS = {
  documentId: 'doc-1',
  versionId: 'ver-1',
  page: 2,
  widthPt: 2384,
  heightPt: 1684,
  widthMm: 841,
  heightMm: 594,
  rotation: 0,
  scan: false,
  vertices: [0.1, 0.2],
  segments: [0.1, 0.2, 0.3, 0.2],
  totalSegments: 1,
  truncated: false,
  scales: [
    {
      region: null,
      state: 'estimated',
      source: 'scale_note',
      metresPerShare: [84.1, 59.4],
      ratio: 100,
    },
  ],
}

describe('snap-wire', () => {
  it('reads the engine answer and refuses shares in odd counts or off the page', () => {
    expect(snapTargetsResponseSchema.parse({ targets: TARGETS })).toEqual({ targets: TARGETS })
    expect(
      snapTargetsResponseSchema.safeParse({ targets: { ...TARGETS, vertices: [0.1] } }).success
    ).toBe(false)
    expect(
      snapTargetsResponseSchema.safeParse({ targets: { ...TARGETS, segments: [0, 0, 1.2, 0] } })
        .success
    ).toBe(false)
  })

  it('raises a page the engine could not read as a refusal with its reason', async () => {
    const unread = async () => Response.json({ unavailable: { reason: 'too many lines' } })
    await expect(fetchSnapTargets('d', 1, unread)).rejects.toEqual(
      new SnapTargetsRequestError(422, 'UNAVAILABLE', 'too many lines')
    )
  })

  it('fetches the page path and raises a refusal with its code', async () => {
    const run = vi.fn(async () => Response.json({ targets: TARGETS }))
    expect(await fetchSnapTargets('a/b', 2, run)).toEqual(TARGETS)
    expect(run).toHaveBeenCalledWith('/api/documents/a%2Fb/snap-targets?page=2', { method: 'GET' })
    expect(snapTargetsPath('d', 3)).toBe('/api/documents/d/snap-targets?page=3')
    const refuse = async () =>
      Response.json({ code: 'feature_disabled', error: 'off' }, { status: 403 })
    await expect(fetchSnapTargets('d', 1, refuse)).rejects.toEqual(
      new SnapTargetsRequestError(403, 'feature_disabled', 'off')
    )
  })
})
