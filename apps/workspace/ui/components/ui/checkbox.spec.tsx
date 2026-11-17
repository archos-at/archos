import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('draws a half-filled box as filled ink with a dash, not a tick', () => {
    render(<Checkbox checked="indeterminate" aria-label="Alle" />)

    const box = screen.getByRole('checkbox', { name: 'Alle' })
    expect(box).toHaveAttribute('data-state', 'indeterminate')
    expect(box).toHaveAttribute('aria-checked', 'mixed')
    expect(box.className).toContain('data-[state=indeterminate]:bg-primary')
    const dash = box.querySelector('[data-slot="checkbox-dash"]')
    const check = box.querySelector('[data-slot="checkbox-check"]')
    expect(dash).not.toBeNull()
    expect(dash?.getAttribute('class')).toContain('group-data-[state=indeterminate]/indicator:block')
    expect(check?.getAttribute('class')).toContain('group-data-[state=indeterminate]/indicator:hidden')
    expect(box.querySelector('[data-slot="checkbox-indicator"]')).toHaveAttribute('data-state', 'indeterminate')
  })

  it('draws a ticked box with the tick, and an empty box with nothing', () => {
    const { rerender } = render(<Checkbox checked aria-label="Eine" />)
    expect(screen.getByRole('checkbox').querySelector('[data-slot="checkbox-indicator"]')).toHaveAttribute(
      'data-state',
      'checked',
    )

    rerender(<Checkbox checked={false} aria-label="Eine" />)
    const indicator = screen.getByRole('checkbox').querySelector('[data-slot="checkbox-indicator"]')
    expect(indicator).toHaveAttribute('data-state', 'unchecked')
    expect(indicator?.getAttribute('class')).toContain('data-[state=unchecked]:opacity-0')
  })

  it('does not replay an entrance when it mounts already checked', () => {
    render(<Checkbox defaultChecked aria-label="Eine" />)
    const indicator = screen.getByRole('checkbox').querySelector('[data-slot="checkbox-indicator"]')
    expect(indicator?.getAttribute('class')).not.toContain('animate-in')
    expect(indicator?.getAttribute('class')).toContain('transition-[opacity,scale]')
  })
})
