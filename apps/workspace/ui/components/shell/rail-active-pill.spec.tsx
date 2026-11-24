import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const props = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('@/components/motion', () => ({
  springGlide: {},
  motion: { span: (p: Record<string, unknown>) => (props.push(p), <span data-slot={p['data-slot'] as string} />) },
}))

import { RailActivePill } from './rail-active-pill'

describe('RailActivePill', () => {
  it('measures its layout only when its row changes, so a resize of the rail does not leave it a spring behind', () => {
    render(<RailActivePill pillId="rail-active-project-full" at="/app/office-shelf" />)
    expect(props.at(-1)).toMatchObject({ layoutId: 'rail-active-project-full', layoutDependency: '/app/office-shelf' })
  })
})
