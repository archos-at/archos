import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { ComposerSubject } from '@/features/chat/types'

import { ComposerSubjectBar } from './composer-subject-bar'

const STATUS_BODY = {
  id: 'doc-aufsicht',
  filename: '220724_Aufsicht_1_100.pdf',
  displayName: 'Aufsicht 1:100',
  scope: 'project',
  openVersion: null,
}

function renderBar(subject: ComposerSubject, onResolved = vi.fn()) {
  const view = render(
    <I18nProvider initialLocale="de" fixedLocale>
      <ComposerSubjectBar
        subject={subject}
        projectId="proj-1"
        onClear={() => undefined}
        onResolved={onResolved}
      />
    </I18nProvider>
  )
  const rerenderWithFreshHandler = (): void => {
    view.rerender(
      <I18nProvider initialLocale="de" fixedLocale>
        <ComposerSubjectBar
          subject={subject}
          projectId="proj-1"
          onClear={() => undefined}
          onResolved={(identity) => onResolved(identity)}
        />
      </I18nProvider>
    )
  }
  return Object.assign(onResolved, { rerenderWithFreshHandler })
}

describe('ComposerSubjectBar identity recovery', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => STATUS_BODY })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('recovers filename and shelf for a subject restored from an id alone', async () => {
    const onResolved = renderBar({ resourceType: 'document', resourceId: 'doc-aufsicht', title: null })

    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({
        title: 'Aufsicht 1:100',
        filename: '220724_Aufsicht_1_100.pdf',
        shelf: 'project',
        versionId: null,
        versionState: null,
      })
    )
  })

  test('looks the document up even when a title is already present', async () => {
    const onResolved = renderBar({
      resourceType: 'document',
      resourceId: 'doc-aufsicht',
      title: 'Aufsicht 1:100',
    })

    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(onResolved.mock.calls[0][0]).toMatchObject({ filename: '220724_Aufsicht_1_100.pdf' })
  })

  test('still looks up a subject whose visible fields are all filled', async () => {
    renderBar({
      resourceType: 'document',
      resourceId: 'doc-aufsicht',
      title: 'Aufsicht 1:100',
      filename: '220724_Aufsicht_1_100.pdf',
      shelf: 'project',
    })

    await screen.findByTestId('composer-subject-bar')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('reports the open version, so the turn can read what retrieval cannot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...STATUS_BODY,
          openVersion: { id: 'ver-9', state: 'in_review' },
        }),
      })
    )
    const onResolved = renderBar({ resourceType: 'document', resourceId: 'doc-aufsicht', title: null })

    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(onResolved.mock.calls[0][0]).toMatchObject({
      versionId: 'ver-9',
      versionState: 'in_review',
    })
  })

  test('ignores a version state the lifecycle does not have', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...STATUS_BODY, openVersion: { id: 'ver-9', state: 'invented' } }),
      })
    )
    const onResolved = renderBar({ resourceType: 'document', resourceId: 'doc-aufsicht', title: null })

    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(onResolved.mock.calls[0][0].versionState).toBeNull()
  })

  test('looks a document up once, not once per composer re-render', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => null }))
    const onResolved = renderBar({
      resourceType: 'document',
      resourceId: 'doc-gone',
      title: null,
    })

    await screen.findByTestId('composer-subject-bar')
    expect(fetch).toHaveBeenCalledTimes(1)

    onResolved.rerenderWithFreshHandler()
    onResolved.rerenderWithFreshHandler()
    onResolved.rerenderWithFreshHandler()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('ignores a scope the client does not know rather than passing it through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...STATUS_BODY, scope: 'something-new' }),
      })
    )
    const onResolved = renderBar({ resourceType: 'document', resourceId: 'doc-aufsicht', title: null })

    await waitFor(() => expect(onResolved).toHaveBeenCalled())
    expect(onResolved.mock.calls[0][0].shelf).toBeUndefined()
  })
})
