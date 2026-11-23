import { describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { render, screen } from '@/test-utils'
import { FlowInner } from '@/features/chat/components/reasoning/flow/flow-inner'
import { planFan } from '@/features/chat/components/reasoning/flow/flow-layout'

const flow = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }))

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  const { createElement } = await import('react')
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      flow.props = props
      return createElement('div', { 'data-testid': 'react-flow' })
    },
  }
})

describe('no library stylesheet keeps the page scroll', () => {
  it('the reasoning graph opts into the override', () => {
    render(
      <ReactFlowProvider>
        <FlowInner built={{ nodes: [], edges: [], rows: [] }} layout={planFan(680, 0)} live={false} />
      </ReactFlowProvider>,
    )
    const pane = screen.getByTestId('reasoning-flow')
    expect(pane).toHaveClass('reasoning-flow-scrollable')
    expect(pane).toContainElement(screen.getByTestId('react-flow'))
    expect(flow.props).toMatchObject({
      panOnDrag: false,
      panOnScroll: false,
      zoomOnScroll: false,
      zoomOnPinch: false,
    })
  })
})
