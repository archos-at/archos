import { render, screen } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { SourceBasisTrigger } from './SourceBasisTrigger'

vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ idToken: null }) }))

describe('SourceBasisTrigger', () => {
  // The composer mounts with every switch of project or scope; the label it shows then is where things stand,
  // not a change, so it stands at once (it slid 4px in from the right on every mount).
  test('a single basis label mounts standing, without its entrance', () => {
    render(<SourceBasisTrigger />)
    const label = screen.getByRole('button').querySelector<HTMLElement>('span.inline-flex span.inline-flex')
    expect(label).not.toBeNull()
    expect(label!.style.opacity).not.toBe('0')
    expect(label!.style.transform).not.toMatch(/translateX\(4px\)/)
  })
})
