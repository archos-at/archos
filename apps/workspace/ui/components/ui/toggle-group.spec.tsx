import type { JSX } from 'react'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

function pills(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="toggle-pill"]'))
}

function View({ initial = 'list' }: { initial?: string }): JSX.Element {
  const [view, setView] = useState(initial)
  return (
    <ToggleGroup type="single" value={view} onValueChange={setView} segmented aria-label="View">
      <ToggleGroupItem value="list">Liste</ToggleGroupItem>
      <ToggleGroupItem value="timetable">Zeitplan</ToggleGroupItem>
    </ToggleGroup>
  )
}

describe('segmented ToggleGroup', () => {
  it('draws exactly one pill, on the selected segment', () => {
    const { container } = render(<View />)
    const found = pills(container)
    expect(found).toHaveLength(1)
    expect(found[0]!.closest('button')).toHaveTextContent('Liste')
  })

  it('moves the pill to whichever segment is chosen', async () => {
    const user = userEvent.setup()
    const { container } = render(<View />)

    await user.click(screen.getByRole('radio', { name: 'Zeitplan' }))

    const found = pills(container)
    expect(found).toHaveLength(1)
    expect(found[0]!.closest('button')).toHaveTextContent('Zeitplan')
  })

  it('gives two groups on one screen DIFFERENT pill identities', () => {
    const { container } = render(
      <>
        <View />
        <ToggleGroup type="single" value="all" segmented aria-label="Filter">
          <ToggleGroupItem value="all">Alle</ToggleGroupItem>
          <ToggleGroupItem value="unreviewed">Ungeprüft</ToggleGroupItem>
        </ToggleGroup>
      </>
    )

    const ids = pills(container).map((pill) => pill.getAttribute('data-pill-id'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('keeps ONE identity within a group, which is what makes the glide a glide', async () => {
    const user = userEvent.setup()
    const { container } = render(<View />)
    const before = pills(container)[0]!.getAttribute('data-pill-id')

    await user.click(screen.getByRole('radio', { name: 'Zeitplan' }))

    expect(pills(container)[0]!.getAttribute('data-pill-id')).toBe(before)
  })

  it('moves the pill when the group is UNCONTROLLED too', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ToggleGroup type="single" defaultValue="list" segmented aria-label="View">
        <ToggleGroupItem value="list">Liste</ToggleGroupItem>
        <ToggleGroupItem value="timetable">Zeitplan</ToggleGroupItem>
      </ToggleGroup>
    )
    expect(pills(container)[0]!.closest('button')).toHaveTextContent('Liste')

    await user.click(screen.getByRole('radio', { name: 'Zeitplan' }))

    expect(pills(container)[0]!.closest('button')).toHaveTextContent('Zeitplan')
  })

  it('draws no pill at all when the group is not segmented', () => {
    const { container } = render(
      <ToggleGroup type="single" value="list" aria-label="View">
        <ToggleGroupItem value="list">Liste</ToggleGroupItem>
      </ToggleGroup>
    )
    expect(pills(container)).toHaveLength(0)
  })
})
