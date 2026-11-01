/**
 * „Als Skizze bearbeiten“ on a sketch Piloti drew in the chat (ADR-0148, C8):
 * it files the sketch once, as drawn and keyed by its fence, and opens the
 * filed document's review; a second press opens the same document, so two
 * people editing one card land on one Skizze, not two.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { DiagramFilingProvider } from '../diagram-filing-context'

vi.mock('../sketch/sketch-render', () => ({
  renderSketch: async () => ({ svg: '<svg viewBox="0 0 100 50"></svg>', scene: '{"type":"excalidraw","elements":[]}' }),
}))
const opened = vi.hoisted(() => vi.fn(async () => 'beside' as const))
vi.mock('@/features/documents/open-document-review', () => ({ openReviewAt: opened }))

import { SketchFigure } from './sketch-figure'

const FENCE = JSON.stringify({ title: 'Zonen', elements: [{ type: 'rectangle', id: 'a', x: 0, y: 0, label: { text: 'Wohnen' } }] })

afterEach(() => {
  vi.unstubAllGlobals()
  opened.mockClear()
})

describe('„Als Skizze bearbeiten“ in the chat', () => {
  it('files the sketch once, as drawn, and opens the filed document’s review each time', async () => {
    const posts: Array<{ runId: string; edited?: boolean }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        posts.push(JSON.parse(String(init?.body)))
        return { ok: true, status: 201, json: async () => ({ svg: { documentId: 'doc-sketch' }, pdf: { documentId: 'doc-pdf' } }) }
      })
    )
    render(
      <I18nProvider initialLocale="de" fixedLocale>
        <DiagramFilingProvider target={{ projectId: 'proj-1', answerId: 'msg-1' }}>
          <SketchFigure source={FENCE} />
        </DiagramFilingProvider>
      </I18nProvider>
    )
    const edit = await screen.findByTestId('sketch-edit')
    await act(async () => fireEvent.click(edit))
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
    expect(opened.mock.calls[0]).toEqual([{ documentId: 'doc-sketch' }, expect.objectContaining({ projectId: 'proj-1' })])
    // Filed as drawn, keyed by the fence: not an edited copy keyed by a scene.
    expect(posts).toHaveLength(1)
    expect(posts[0].edited).toBeUndefined()
    expect(screen.queryByTestId('sketch-dialog')).toBeNull()

    await act(async () => fireEvent.click(screen.getByTestId('sketch-edit')))
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2))
    expect(posts).toHaveLength(1)
  })
})
