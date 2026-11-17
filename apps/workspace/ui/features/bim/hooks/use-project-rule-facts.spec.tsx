import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useProjectRuleFacts } from './use-bim-model'

function stubProfile(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  )
}

describe('useProjectRuleFacts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the facts the catalogue needs', async () => {
    stubProfile({ facts: { building_class: { value: 4 }, main_use: { value: 'residential' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.buildingClass).toBe(4))
    expect(result.current.mainUse).toBe('residential')
    expect(result.current.missing).toEqual([])
  })

  it('accepts a Gebäudeklasse the profile stored as a string', async () => {
    stubProfile({ facts: { building_class: { value: '3' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.buildingClass).toBe(3))
  })

  it('refuses a Gebäudeklasse outside 1–5 rather than clamping it', async () => {
    stubProfile({ facts: { building_class: { value: 9 } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.buildingClass).toBeNull()
    expect(result.current.missing).toContain('buildingClass')
  })

  it('reads the canonical GK form the brief actually stores', async () => {
    stubProfile({ facts: { building_class: { value: 'GK4' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.buildingClass).toBe(4))
    expect(result.current.missing).not.toContain('Gebäudeklasse')
  })

  it('accepts a bare number, which nothing forbids', async () => {
    stubProfile({ facts: { building_class: { value: 4 } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.buildingClass).toBe(4))
  })

  it('refuses a Gebäudeklasse it cannot read', async () => {
    stubProfile({ facts: { building_class: { value: 'Klasse vier' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.buildingClass).toBeNull()
    expect(result.current.missing).toContain('buildingClass')
  })

  it('treats an empty Hauptnutzung as absent', async () => {
    stubProfile({ facts: { main_use: { value: '  ' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.mainUse).toBeNull()
    expect(result.current.missing).toContain('mainUse')
  })

  it('names no gap at all until the brief has actually been read', async () => {
    stubProfile({ facts: { building_class: { value: 'GK4' }, main_use: { value: 'residential' } } })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))

    expect(result.current.ready).toBe(false)
    expect(result.current.missing).toEqual([])

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.missing).toEqual([])
  })

  it('names both gaps when the profile carries neither', async () => {
    stubProfile({ facts: {} })
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.failed).toBe(false)
    expect(result.current.missing).toEqual(['buildingClass', 'mainUse'])
  })

  it('reports a profile it could not READ as that, not as a brief with gaps', async () => {
    stubProfile({}, false)
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.failed).toBe(true)
    expect(result.current.missing).toEqual([])
    expect(result.current.buildingClass).toBeNull()
  })

  it('clears the failure when the retry succeeds', async () => {
    stubProfile({}, false)
    const { result } = renderHook(() => useProjectRuleFacts('p1'))
    await waitFor(() => expect(result.current.failed).toBe(true))

    stubProfile({ facts: { building_class: { value: 'GK4' } } })
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.buildingClass).toBe(4))
    expect(result.current.failed).toBe(false)
  })

  it('fetches nothing without a project', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useProjectRuleFacts(null))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports itself unsettled until the brief has been read', async () => {
    const { result } = renderHook(() => useProjectRuleFacts('p1'))

    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('settles even when the brief cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    )
    const { result } = renderHook(() => useProjectRuleFacts('p1'))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.buildingClass).toBeNull()
  })

  it('is settled immediately when there is no project', () => {
    const { result } = renderHook(() => useProjectRuleFacts(null))

    expect(result.current.ready).toBe(true)
  })
})
