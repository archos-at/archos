/**
 * A Skizze's stage in its review (ADR-0148): it reads the Skizze, puts its
 * canvas where the pages would be (marked as the keyboard's), its save into
 * the review's header, and answers the review's close with the discard
 * question while strokes are unsaved. An SVG without a scene shows its
 * picture with its marks.
 *
 * The canvas is a stand-in (Excalidraw is not loaded in a spec): it hands over
 * its handle and can be made dirty.
 */
import type { ComponentType } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'

const canvas = vi.hoisted(() => ({ dirty: null as null | ((dirty: boolean) => void) }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function FakeCanvas({ onReady, onDirtyChange }: { onReady: (handle: object) => void; onDirtyChange: (dirty: boolean) => void }) {
      onReady({ prepare: async () => ({ source: '{"type":"excalidraw","elements":[]}', svg: '<svg/>' }), markSaved: () => onDirtyChange(false) })
      canvas.dirty = onDirtyChange
      return <div data-testid="fake-canvas" />
    },
}))
vi.mock('./use-sketch-room', () => ({
  useSketchRoom: () => ({
    collab: null,
    base: () => 'v1',
    peerId: 'peer_me',
    peerSave: null,
    tooLarge: [],
    refused: [],
    otherPeople: () => ['Max Huber'],
    mergeFrom: () => {},
    announceSave: async () => {},
  }),
}))
vi.mock('./sketch-pins', () => ({ SketchPins: () => null }))
vi.mock('@/features/documents/sketch-review', () => ({
  ReviewPageLayer: () => <div data-testid="sheet-marks" />,
}))

import { SketchStage } from './sketch-stage'

const SKETCH = { documentId: 'doc-svg', versionId: 'v1', title: 'Stiege', canWrite: true, scene: { type: 'excalidraw', elements: [] } }
const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

afterEach(() => vi.unstubAllGlobals())

function stage({ fetch, onChanged = () => {}, close = () => {} }: { fetch: ReturnType<typeof vi.fn>; onChanged?: () => void; close?: () => void }) {
  vi.stubGlobal('fetch', fetch)
  const slot = document.createElement('div')
  slot.dataset.testid = 'header-slot'
  document.body.append(slot)
  let guard: (() => boolean) | null = null
  const review = { room: {}, canAnnotate: true, setDraft: () => {} } as never
  const Stage = SketchStage as ComponentType<Parameters<typeof SketchStage>[0]>
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <Stage
        documentId="doc-svg"
        review={review}
        canPickAssignee
        onChanged={onChanged}
        headerSlot={slot}
        setCloseGuard={(next) => void (guard = next)}
        close={close}
        cardsDocked={false}
      />
    </I18nProvider>
  )
  return { slot, guard: () => guard }
}

describe('a Skizze’s stage', () => {
  it('reads the Skizze, holds the canvas as the keyboard’s, and saves a Fassung from the review’s header', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? respond(200, { documentId: 'doc-svg', versionId: 'v2', versionNumber: 2, pdf: null }) : respond(200, SKETCH)
    )
    const onChanged = vi.fn()
    const { slot } = stage({ fetch, onChanged })
    const drawn = await screen.findByTestId('fake-canvas')
    expect(drawn.closest('[data-stage-keys]')).not.toBeNull()
    expect(fetch.mock.calls[0][0]).toBe('/api/documents/doc-svg/sketch')
    const save = within(slot).getByTestId('sketch-save')
    expect(save).toHaveTextContent('Als neue Fassung speichern')
    await act(async () => fireEvent.click(save))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByTestId('sketch-status')).toHaveTextContent('Als Fassung 2 gespeichert')
    slot.remove()
  })

  it('answers the review’s close with the discard question while strokes are unsaved, naming who stays', async () => {
    const close = vi.fn()
    const { slot, guard } = stage({ fetch: vi.fn(async () => respond(200, SKETCH)), close })
    await screen.findByTestId('fake-canvas')
    expect(guard()?.()).toBe(true)
    act(() => canvas.dirty?.(true))
    let answer: boolean | undefined
    act(() => void (answer = guard()?.()))
    expect(answer).toBe(false)
    expect(screen.getByTestId('sketch-discard')).toHaveTextContent('Max Huber')
    fireEvent.click(screen.getByTestId('sketch-discard-confirm'))
    expect(close).toHaveBeenCalled()
    slot.remove()
  })

  it('offers the Skizze’s PDF from its header, the rendition Files no longer lists beside it', async () => {
    const { slot } = stage({ fetch: vi.fn(async () => respond(200, { ...SKETCH, pdfDocumentId: 'doc-pdf' })) })
    await screen.findByTestId('fake-canvas')
    expect(within(slot).getByTestId('sketch-download-pdf')).toHaveAccessibleName('PDF herunterladen')
    slot.remove()
  })

  it('shows an SVG without a scene as its picture with its marks, and offers no save', async () => {
    const { slot } = stage({ fetch: vi.fn(async () => respond(415, { error: 'Not a sketch' })) })
    expect(await screen.findByTestId('sketch-stage-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-marks')).toBeInTheDocument()
    expect(within(slot).queryByTestId('sketch-save')).toBeNull()
    slot.remove()
  })
})
