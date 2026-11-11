import { render, screen } from '@/test-utils'
import { describe, expect, test } from 'vitest'

import { ItemList } from '@/components/ui/item'
import type { Project } from '@/lib/db/schema/projects'
import { makeProject } from '@/test-utils/db-fixtures'
import { ProjectListRow } from './project-list-row'

const withSiteAddress = (address: string): Project['profile'] => ({
  facts: { site_address: { value: address, confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-07-01T00:00:00Z' } },
  goals: {},
  unknowns: [],
  assumptions: {},
})

// The list the projects page draws the row in, so the row is tested in place.
const renderRow = (props: Partial<Parameters<typeof ProjectListRow>[0]> = {}) =>
  render(
    <ItemList as="ul">
      <ProjectListRow project={makeProject({ id: 'p1', name: 'Wohnbau Seestadt' })} {...props} />
    </ItemList>,
  )

describe('ProjectListRow', () => {
  /**
   * Rows are one connected list, so only the list's outer corners are rounded.
   * A row that brings its own radius, border or shadow is a pill again: the
   * corners go orphaned over the hairline, and the seam doubles.
   */
  test('is a row of the connected list, with no pill of its own', () => {
    renderRow()

    const row = screen.getByRole('link', { name: 'Open Wohnbau Seestadt' }).closest('li')
    expect(row?.parentElement).toHaveAttribute('data-slot', 'item-list')
    expect(row?.className).not.toMatch(/\brounded|\bborder\b|\bshadow/)
  })

  test('opens the project in Chat and keeps the overview as its own 44px link', () => {
    renderRow()

    expect(screen.getByRole('link', { name: 'Open Wohnbau Seestadt' })).toHaveAttribute(
      'href',
      '/app/projects/p1/chat',
    )
    const overview = screen.getByRole('link', { name: 'Open overview of Wohnbau Seestadt' })
    expect(overview).toHaveAttribute('href', '/app/projects/p1/settings')
    expect(overview).toHaveClass('pointer-coarse:size-11')
  })

  test('indexes the row with the project initials', () => {
    renderRow()
    expect(screen.getByText('WS')).toBeInTheDocument()
  })

  test('labels the timestamp as the viewer’s own only when it is', () => {
    const { unmount } = renderRow({ activityAt: '2026-08-05T09:00:00Z' })
    expect(screen.getByTitle(/^You were last here:/)).toBeInTheDocument()
    unmount()

    renderRow()
    expect(screen.getByTitle(/^Last activity:/)).toBeInTheDocument()
  })

  /**
   * The second line is where the project is, not the brief cut to one line: the
   * summary broke mid-sentence and told nobody which project this was.
   */
  test('shows the site address as the second line, never the brief', () => {
    renderRow({
      project: makeProject({
        id: 'p1',
        name: 'Wohnbau Seestadt',
        profile: withSiteAddress('Janis-Joplin-Promenade 12, 1220 Wien'),
        profileDisplay: {
          title: 'Wohnbau Seestadt',
          summary: 'Wohnbau · 214 Wohneinheiten · GK 5 · Wien',
          keyFacts: [],
          missingInfo: [],
        },
      }),
    })
    expect(screen.getByTestId('project-location')).toHaveTextContent('Janis-Joplin-Promenade 12, 1220 Wien')
    expect(screen.queryByText('Wohnbau · 214 Wohneinheiten · GK 5 · Wien')).not.toBeInTheDocument()
  })

  /** A placeholder repeated down the list would be the loudest line on the rows that carry the least. */
  test('leaves the second line out entirely when the project has no address', () => {
    renderRow()
    expect(screen.queryByTestId('project-location')).not.toBeInTheDocument()
  })

  /**
   * `getProjectStatus` can only return `active`, so on a list the chip is the
   * same tinted pill on every row — a band of chroma carrying no information.
   * It stays on the card and comes back here when a second status exists.
   */
  test('does not repeat the constant status chip on every row', () => {
    renderRow()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })
})
