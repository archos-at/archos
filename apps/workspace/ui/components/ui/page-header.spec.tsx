import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header'

describe('PageHeader', () => {
  it('stacks the title above the action on a narrow viewport', () => {
    const { container } = render(
      <PageHeader
        title="History"
        subtitle="Every conversation and deep-research run in this project."
        action={<input aria-label="Search" className="w-full sm:w-64" />}
      />,
    )
    const row = container.querySelector('header')!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('sm:flex-row')
    expect(row.className).toContain('items-stretch')
  })

  it('gives the title a floor so the action is the side that yields', () => {
    const { container } = render(
      <PageHeader title="History" subtitle="Every conversation." action={<button type="button">New</button>} />,
    )
    const titleColumn = container.querySelector('h1')!.parentElement!
    expect(titleColumn.className).toContain('sm:min-w-56')
    expect(titleColumn.className.split(/\s+/)).toContain('min-w-0')
  })

  it('never lets the action refuse to shrink', () => {
    const { container } = render(
      <PageHeader title="History" action={<button type="button">New</button>} />,
    )
    const wrapper = screen.getByRole('button', { name: 'New' }).parentElement!
    expect(wrapper.className).not.toContain('shrink-0')
    expect(wrapper.className.split(/\s+/)).toContain('min-w-0')
    expect(container.querySelector('h1')).toHaveTextContent('History')
  })

  it('keeps the documented title size', () => {
    render(<PageHeader title="History" />)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-page-title')
  })

  it('hides the description and compacts the title on a phone, and only there', () => {
    render(<PageHeader title="Files" subtitle="The documents of this project." />)
    const subtitle = screen.getByText('The documents of this project.')
    expect(subtitle.className.split(/\s+/)).toContain('phone:hidden')
    expect(subtitle.className.split(/\s+/)).not.toContain('hidden')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.className).toContain('text-page-title')
    expect(title.className).toContain('phone:text-section')
  })

  it('keeps the description on a phone for a page that asks to, a page the tab bar does not name', () => {
    render(<PageHeader title="My memory" subtitle="What is kept about you." subtitleOnPhone />)
    expect(screen.getByText('What is kept about you.').className.split(/\s+/)).not.toContain('phone:hidden')
  })
})
