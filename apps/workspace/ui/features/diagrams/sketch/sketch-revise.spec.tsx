/**
 * A filed Skizze saved from its review (ADR-0148): as a new Fassung, with a
 * newer one reported rather than overwritten.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSketchRevision } from './use-sketch-revision'

const SKETCH = {
  documentId: 'doc-svg',
  versionId: 'v1',
  title: 'Raumprogramm',
  scene: { type: 'excalidraw', elements: [{ id: 'room', type: 'rectangle' }] },
}

function respond(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body }
}

afterEach(() => vi.unstubAllGlobals())

describe('useSketchRevision', () => {
  const prepare = async () => ({ source: JSON.stringify(SKETCH.scene), svg: '<svg/>' })

  it('saves the scene against the Fassung it opened and reports the new number', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { documentId: 'doc-svg', versionId: 'v2', versionNumber: 2, pdf: null })
    )
    vi.stubGlobal('fetch', fetch)
    const onSaved = vi.fn()
    const { result } = renderHook(() => useSketchRevision({ documentId: 'doc-svg', baseVersionId: 'v1' }, prepare, onSaved))
    await act(() => result.current.save())
    expect(result.current.state).toEqual({ kind: 'saved', versionId: 'v2', versionNumber: 2, pdfStale: false, draft: false })
    expect(fetch.mock.calls[0][1]?.method).toBe('PUT')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      // No picture: the server draws it from the scene (ADR-0149).
      scene: SKETCH.scene,
      baseVersionId: 'v1',
      baseContentHash: null,
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('tells a person a newer Fassung exists on 409, and overwrites nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409, { error: 'A newer version', details: { reason: 'stale_base_version', currentVersionId: 'v3' } }))
    )
    const { result } = renderHook(() => useSketchRevision({ documentId: 'doc-svg', baseVersionId: 'v1' }, prepare))
    await act(() => result.current.save())
    expect(result.current.state).toEqual({ kind: 'stale' })
  })

  it('in a room: saves against the base it has then, and after a 409 merges the newer Fassung and tries once more', async () => {
    const answers = [
      respond(409, { error: 'A newer version', details: { reason: 'stale_base_version', currentVersionId: 'v3' } }),
      respond(200, { documentId: 'doc-svg', versionId: 'v4', versionNumber: 4, pdf: null }),
    ]
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => answers.shift()!)
    vi.stubGlobal('fetch', fetch)
    let base = 'v1'
    const resolveStale = vi.fn(async () => {
      base = 'v3'
      return true
    })
    const { result } = renderHook(() =>
      useSketchRevision({ documentId: 'doc-svg', baseVersionId: () => base }, prepare, undefined, resolveStale)
    )
    await act(() => result.current.save())
    expect(resolveStale).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).baseVersionId)).toEqual(['v1', 'v3'])
    expect(result.current.state).toEqual({ kind: 'saved', versionId: 'v4', versionNumber: 4, pdfStale: false, draft: false })
  })

  it('in a room: takes the base before the scene, so a merge while the picture is drawn makes the save stale, not lossy', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { documentId: 'doc-svg', versionId: 'v3', versionNumber: 3, pdf: null, pdfStale: true })
    )
    vi.stubGlobal('fetch', fetch)
    let base = 'v1'
    // A newer Fassung is merged in while the canvas draws its SVG.
    const slowPrepare = async () => {
      base = 'v2'
      return prepare()
    }
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useSketchRevision({ documentId: 'doc-svg', baseVersionId: () => base, peerId: () => 'peer_anna0001' }, slowPrepare, onSaved)
    )
    await act(() => result.current.save())
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).baseVersionId).toBe('v1')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-room-peer-id')).toBe('peer_anna0001')
    expect(result.current.state).toMatchObject({ kind: 'saved', pdfStale: true })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ elements: SKETCH.scene.elements }))
  })

  it('saves into the open Freigabe draft from the hash it sits on, and says it is the draft', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { versionId: 'd1', versionNumber: 3, state: 'draft', contentHash: 'sha256:new' })
    )
    vi.stubGlobal('fetch', fetch)
    const onSaved = vi.fn()
    const target = { documentId: 'doc-svg', baseVersionId: 'd1', baseContentHash: () => 'sha256:old' }
    const { result } = renderHook(() => useSketchRevision(target, prepare, onSaved))
    await act(() => result.current.save())
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ baseVersionId: 'd1', baseContentHash: 'sha256:old' })
    expect(result.current.state).toMatchObject({ kind: 'saved', draft: true, versionNumber: 3 })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ state: 'draft', contentHash: 'sha256:new' }))
  })

  it('says the sketch is in review on 409 review_open, saves nothing, and lets the person draw on (C4)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409, { error: 'In review', details: { reason: 'review_open', versionId: 'd1', state: 'in_review' } }))
    )
    const resolveStale = vi.fn(async () => true)
    const { result } = renderHook(() => useSketchRevision({ documentId: 'doc-svg', baseVersionId: 'v1' }, prepare, undefined, resolveStale))
    await act(() => result.current.save())
    expect(result.current.state).toEqual({ kind: 'review_open' })
    expect(resolveStale).not.toHaveBeenCalled()
    act(() => result.current.dismiss())
    expect(result.current.state).toEqual({ kind: 'idle' })
  })

  it('in a room: a second 409 asks the person to save again, the newer Fassung merged', async () => {
    const stale = () => respond(409, { error: 'A newer version', details: { reason: 'stale_base_version' } })
    vi.stubGlobal('fetch', vi.fn(async () => stale()))
    const { result } = renderHook(() =>
      useSketchRevision({ documentId: 'doc-svg', baseVersionId: 'v1' }, prepare, undefined, async () => true)
    )
    await act(() => result.current.save())
    expect(result.current.state).toEqual({ kind: 'stale', merged: true })
  })
})
