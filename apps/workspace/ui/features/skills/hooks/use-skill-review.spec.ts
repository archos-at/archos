import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillReview } from './use-skill-review'

const reviewSkill = vi.fn()
vi.mock('@/adapters/api/skills-client', () => ({
  reviewSkill: (...args: unknown[]) => reviewSkill(...args),
}))

const DRAFT = { name: 'oib-check', description: 'Prüft etwas.', body: 'Schritte' }

beforeEach(() => {
  reviewSkill.mockReset()
})

describe('useSkillReview', () => {
  it('asks for nothing until the author asks for it', () => {
    const { result } = renderHook(() => useSkillReview(DRAFT))
    expect(reviewSkill).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ kind: 'idle' })
    expect(result.current.gate.checked).toBe(false)
  })

  it('reviews the CURRENT draft, not a remembered one', async () => {
    reviewSkill.mockResolvedValue({ findings: [] })
    const { result } = renderHook(() => useSkillReview(DRAFT))
    await act(() => result.current.run())
    expect(reviewSkill).toHaveBeenCalledWith(DRAFT)
  })

  it('orders findings worst-first, and files each under its own field', async () => {
    reviewSkill.mockResolvedValue({
      findings: [
        { severity: 'suggestion', field: 'body', message: 'Add an example.', fix: 'Show output.' },
        { severity: 'error', field: 'description', message: 'No WHEN clause.', fix: 'Add one.' },
        { severity: 'warning', field: 'name', message: 'Vague name.', fix: 'Name the domain.' },
      ],
    })
    const { result } = renderHook(() => useSkillReview(DRAFT))
    await act(() => result.current.run())

    expect(result.current.findings.map((f) => f.message)).toEqual([
      'No WHEN clause.',
      'Vague name.',
      'Add an example.',
    ])
    expect(result.current.findingsFor('description').map((f) => f.message)).toEqual([
      'No WHEN clause.',
    ])
    expect(result.current.findingsFor('body').map((f) => f.message)).toEqual(['Add an example.'])
  })

  it('opens the gate on a clean verdict', async () => {
    reviewSkill.mockResolvedValue({ findings: [] })
    const { result } = renderHook(() => useSkillReview(DRAFT))
    await act(() => result.current.run())
    expect(result.current.gate).toEqual({ checked: true, reason: 'reviewed' })
    expect(result.current.stale).toBe(false)
  })

  it('NEVER reads as clean when the review could not run — but never blocks either', async () => {
    reviewSkill.mockResolvedValue({ findings: null, error: 'review_failed' })
    const { result } = renderHook(() => useSkillReview(DRAFT))
    await act(() => result.current.run())

    expect(result.current.state).toEqual({ kind: 'unavailable' })
    expect(result.current.findings).toEqual([])
    expect(result.current.gate).toEqual({ checked: true, reason: 'unavailable' })
  })

  it('goes stale the moment the draft changes, and the gate closes with it', async () => {
    reviewSkill.mockResolvedValue({ findings: [] })
    const { result, rerender } = renderHook((draft) => useSkillReview(draft), {
      initialProps: DRAFT,
    })
    await act(() => result.current.run())
    expect(result.current.stale).toBe(false)

    rerender({ ...DRAFT, description: 'Etwas ganz anderes.' })
    await waitFor(() => expect(result.current.stale).toBe(true))
    expect(result.current.gate.checked).toBe(false)
  })

  it('is stale when the draft moved while the request was in flight', async () => {
    let settle: (value: { findings: [] }) => void = () => {}
    reviewSkill.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const { result, rerender } = renderHook((draft) => useSkillReview(draft), {
      initialProps: DRAFT,
    })

    const running = act(() => result.current.run())
    rerender({ ...DRAFT, body: 'Andere Schritte' })
    settle({ findings: [] })
    await running

    await waitFor(() => expect(result.current.stale).toBe(true))
    expect(result.current.gate.checked).toBe(false)
  })
})
