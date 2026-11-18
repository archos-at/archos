import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IfcProfileSuggestions, IfcQuantityTakeoff, IfcRoomSchedule } from './ifc-model-tables'
import type { BimQuantityRow, BimRoomSchedule } from '@/lib/bim/schedule'

const SCHEDULE: BimRoomSchedule = {
  storeys: [
    {
      storeyName: 'Erdgeschoss',
      elevation: 0,
      rooms: [
        {
          globalId: 'g-wohnen',
          name: 'Wohnzimmer',
          storeyName: 'Erdgeschoss',
          category: 'INTERNAL',
          netFloorArea: 32,
          grossFloorArea: 34.5,
          netVolume: 80,
          height: 2.5,
        },
        {
          globalId: 'g-bad',
          name: 'Bad',
          storeyName: 'Erdgeschoss',
          category: 'INTERNAL',
          netFloorArea: null,
          grossFloorArea: null,
          netVolume: null,
          height: null,
        },
      ],
      netFloorArea: 32,
      grossFloorArea: 34.5,
      netVolume: 80,
      roomsWithoutArea: 1,
    },
  ],
  totals: {
    rooms: 2,
    roomsWithoutArea: 1,
    netFloorArea: 32,
    grossFloorArea: 34.5,
    netVolume: 80,
  },
  units: { area: 'm²', volume: 'm³', length: 'm' },
}

const EMPTY_SCHEDULE: BimRoomSchedule = {
  storeys: [],
  totals: { rooms: 0, roomsWithoutArea: 0, netFloorArea: null, grossFloorArea: null, netVolume: null },
  units: { area: 'm²', volume: 'm³', length: 'm' },
}

describe('IfcRoomSchedule', () => {
  it('groups rooms under their storey and totals each one', () => {
    render(
      <IfcRoomSchedule schedule={SCHEDULE} isLoading={false} error={null} filename="haus-a.ifc" />
    )
    expect(screen.getByRole('columnheader', { name: /Net area \(m²\)/ })).toBeInTheDocument()
    expect(screen.getByText('Wohnzimmer')).toBeInTheDocument()
    const storeyTotal = screen.getByText('Storey total').closest('tr')
    expect(within(storeyTotal!).getByText('32')).toBeInTheDocument()
  })

  it('states how many rooms the total leaves out, at the top and per storey', () => {
    render(
      <IfcRoomSchedule schedule={SCHEDULE} isLoading={false} error={null} filename="haus-a.ifc" />
    )
    expect(
      screen.getByText('Rooms with no published area: 1 — not included in these totals.')
    ).toBeInTheDocument()
    expect(screen.getByText('1 without area')).toBeInTheDocument()
  })

  it('shows a missing area as missing, never as zero', () => {
    render(
      <IfcRoomSchedule schedule={SCHEDULE} isLoading={false} error={null} filename="haus-a.ifc" />
    )
    const bad = screen.getByText('Bad').closest('tr')
    expect(within(bad!).getAllByText('—')).toHaveLength(2)
    expect(within(bad!).queryByText('0')).not.toBeInTheDocument()
  })

  it('selects the room a row is clicked on', async () => {
    const onSelect = vi.fn()
    render(
      <IfcRoomSchedule
        schedule={SCHEDULE}
        isLoading={false}
        error={null}
        filename="haus-a.ifc"
        onSelect={onSelect}
      />
    )
    await userEvent.click(screen.getByText('Wohnzimmer'))
    expect(onSelect).toHaveBeenCalledWith('g-wohnen')
  })

  it('lets a keyboard select a room, not just a pointer', async () => {
    const onSelect = vi.fn()
    render(
      <IfcRoomSchedule
        schedule={SCHEDULE}
        isLoading={false}
        error={null}
        filename="haus-a.ifc"
        onSelect={onSelect}
      />
    )
    const room = screen.getByRole('button', { name: 'Wohnzimmer' })
    room.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('g-wohnen')
  })

  it('says which room is selected, rather than only tinting its row', async () => {
    render(
      <IfcRoomSchedule
        schedule={SCHEDULE}
        isLoading={false}
        error={null}
        filename="haus-a.ifc"
        onSelect={vi.fn()}
        selectedGlobalId="g-wohnen"
      />
    )
    expect(screen.getByRole('button', { name: 'Wohnzimmer' })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('heads each block of rooms with the storey they are on', () => {
    render(
      <IfcRoomSchedule schedule={SCHEDULE} isLoading={false} error={null} filename="haus-a.ifc" />
    )
    const heading = screen.getByText('Erdgeschoss').closest('th')
    expect(heading).toHaveAttribute('scope', 'rowgroup')
  })

  it('offers no CSV for a model with no rooms, and says why', () => {
    render(
      <IfcRoomSchedule
        schedule={EMPTY_SCHEDULE}
        isLoading={false}
        error={null}
        filename="haus-a.ifc"
      />
    )
    expect(screen.getByText('This model contains no rooms (IfcSpace).')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument()
  })

  it('reports a failed load instead of an empty table', () => {
    render(
      <IfcRoomSchedule
        schedule={null}
        isLoading={false}
        error="load-failed"
        filename="haus-a.ifc"
      />
    )
    expect(screen.getByText('The room schedule could not be loaded.')).toBeInTheDocument()
  })
})

const TAKEOFF: BimQuantityRow[] = [
  { group: 'IfcWall · Stahlbeton', elements: 2, value: 46.5, missing: 0 },
  { group: 'IfcWall · (ohne Material)', elements: 1, value: null, missing: 1 },
]

describe('IfcQuantityTakeoff', () => {
  const noop = (): void => {}

  it('shows the sum and, beside it, how many elements published nothing', () => {
    render(
      <IfcQuantityTakeoff
        units={{ area: 'm²', volume: 'm³', length: 'm' }}
        rows={TAKEOFF}
        isLoading={false}
        error={null}
        quantity="NetSideArea"
        onQuantityChange={noop}
        byMaterial
        onByMaterialChange={noop}
      />
    )
    expect(screen.getByText('46.5')).toBeInTheDocument()
    expect(
      screen.getByText('Elements with no published value for this quantity: 1.')
    ).toBeInTheDocument()
    expect(screen.getByText('(1 without value)')).toBeInTheDocument()
  })

  it('changes the quantity being summed', async () => {
    const onQuantityChange = vi.fn()
    render(
      <IfcQuantityTakeoff
        units={{ area: 'm²', volume: 'm³', length: 'm' }}
        rows={TAKEOFF}
        isLoading={false}
        error={null}
        quantity="NetSideArea"
        onQuantityChange={onQuantityChange}
        byMaterial={false}
        onByMaterialChange={noop}
      />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Quantity' }))
    await userEvent.click(screen.getByRole('option', { name: 'Net volume' }))
    expect(onQuantityChange).toHaveBeenCalledWith('NetVolume')
  })

  it('splits by material on request', async () => {
    const onByMaterialChange = vi.fn()
    render(
      <IfcQuantityTakeoff
        units={{ area: 'm²', volume: 'm³', length: 'm' }}
        rows={TAKEOFF}
        isLoading={false}
        error={null}
        quantity="NetSideArea"
        onQuantityChange={noop}
        byMaterial={false}
        onByMaterialChange={onByMaterialChange}
      />
    )
    await userEvent.click(screen.getByLabelText('Split by material'))
    expect(onByMaterialChange).toHaveBeenCalledWith(true)
  })
})

describe('IfcProfileSuggestions', () => {
  const SUGGESTIONS = [
    {
      key: 'storeys_above_ground',
      value: 3,
      confidence: 'high' as const,
      evidence: '3 Geschosse mit Höhenlage ≥ 0 im Modell: EG, OG1, OG2',
    },
    {
      key: 'escape_level',
      value: '<=7m',
      confidence: 'medium' as const,
      evidence: 'Oberstes belegtes Geschoss liegt bei 6 m (OG2)',
    },
  ]

  it('shows every suggestion with its confidence and its evidence', () => {
    render(
      <IfcProfileSuggestions
        suggestions={SUGGESTIONS}
        isLoading={false}
        error={null}
        askHref="/app/projects/p1/chat?ask=x"
      />
    )
    expect(screen.getByText('Storeys above ground')).toBeInTheDocument()
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText(/3 Geschosse mit Höhenlage/)).toBeInTheDocument()
    expect(screen.getByText('Medium confidence')).toBeInTheDocument()
  })

  it('routes the change through the assistant rather than writing it here', () => {
    render(
      <IfcProfileSuggestions
        suggestions={SUGGESTIONS}
        isLoading={false}
        error={null}
        askHref="/app/projects/p1/chat?ask=x"
      />
    )
    const action = screen.getByRole('link', { name: 'Apply via the assistant' })
    expect(action).toHaveAttribute('href', '/app/projects/p1/chat?ask=x')
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()
  })

  it('says the model supports nothing rather than showing an empty list', () => {
    render(
      <IfcProfileSuggestions suggestions={[]} isLoading={false} error={null} askHref="/x" />
    )
    expect(screen.getByText('No project data can be derived from this model.')).toBeInTheDocument()
  })
})
