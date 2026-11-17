import { renderHook } from '@testing-library/react'
import { describe, test, expect, beforeEach } from 'vitest'
import { useDocumentTitle } from './use-document-title'

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Base — Workspace'
  })

  test('leaves the title untouched when passed null', () => {
    renderHook(() => useDocumentTitle(null))
    expect(document.title).toBe('Base — Workspace')
  })

  test('overrides the title while mounted', () => {
    renderHook(() => useDocumentTitle('Override — Workspace'))
    expect(document.title).toBe('Override — Workspace')
  })

  test('restores the previous title on unmount', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Override — Workspace'))
    expect(document.title).toBe('Override — Workspace')

    unmount()
    expect(document.title).toBe('Base — Workspace')
  })

  test('restores the previous title when the override is dropped', () => {
    const { rerender } = renderHook(({ title }: { title: string | null }) => useDocumentTitle(title), {
      initialProps: { title: 'Override — Workspace' as string | null },
    })
    expect(document.title).toBe('Override — Workspace')

    rerender({ title: null })
    expect(document.title).toBe('Base — Workspace')
  })

  test('tracks a changing override and still restores the original base', () => {
    const { rerender, unmount } = renderHook(
      ({ title }: { title: string | null }) => useDocumentTitle(title),
      { initialProps: { title: '10% — Workspace' as string | null } },
    )
    expect(document.title).toBe('10% — Workspace')

    rerender({ title: '50% — Workspace' })
    expect(document.title).toBe('50% — Workspace')

    unmount()
    expect(document.title).toBe('Base — Workspace')
  })
})
