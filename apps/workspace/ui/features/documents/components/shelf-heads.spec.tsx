import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, within } from '@/test-utils'
import { ProjectSectionActions, ProjectSectionFrame, ProjectSectionPlace } from '@/components/shell/project-section-frame'
import { SectionPlaceScope } from '@/components/shell/section-place'
import { SectionToolRowScope } from '@/components/shell/section-tool-row'
import { CLAUSE_JOIN } from '@/lib/format'
import { OfficeShelfHeader } from './office-shelf-workspace'
import { PersonalShelfHead } from './personal-shelf-workspace'

const media = vi.hoisted(() => ({ phone: false }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/projects/p1/files',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  media.phone = false
})

const up = { label: 'Up to Planung', onSelect: () => {} }
const folder = (inFolder: boolean): ReactNode =>
  inFolder ? <ProjectSectionPlace title="Index_C" trail={<span>Trail</span>} phoneTrail={<span>Phone trail</span>} up={up} count="240 items" /> : null
const tools = <button type="button">Upload</button>

type Shelf = 'project' | 'office' | 'personal'
const BAND: Record<Shelf, string> = { project: 'shelf-head', office: 'office-shelf-header', personal: 'personal-shelf-header' }

function show(shelf: Shelf, inFolder: boolean): HTMLElement {
  const phone = media.phone
  const view =
    shelf === 'project' ? (
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" pathname="/app/projects/p1/files">
        <ProjectSectionActions>{tools}</ProjectSectionActions>
        {folder(inFolder)}
      </ProjectSectionFrame>
    ) : (
      <SectionPlaceScope root="Root">
        <SectionToolRowScope enabled={!phone}>
          {shelf === 'office' ? (
            <OfficeShelfHeader controls={tools} count={12} phone={phone} organizationName="Atelier Nord" places={<nav aria-label="places">places</nav>} />
          ) : (
            <PersonalShelfHead controls={tools} count={12} phone={phone} />
          )}
          {folder(inFolder)}
        </SectionToolRowScope>
      </SectionPlaceScope>
    )
  render(view)
  return screen.getByTestId(BAND[shelf])
}

function skeleton(band: HTMLElement): string[] {
  const of = (element: Element | null | undefined, name: string): string => (element ? `${name}: ${element.className}` : `${name}: none`)
  const row = within(band).queryByTestId('files-tool-row')
  const line = band.nextElementSibling?.querySelector('[data-testid="section-place-line"]')
  return [
    of(band, 'band'),
    of(band.querySelector('header'), 'header'),
    of(within(band).queryByTestId('page-header-crumb'), 'crumb'),
    of(band.querySelector('h1'), 'title'),
    of(band.querySelector('[data-slot="page-header-title-line"]'), 'title line'),
    of(row, 'tool row'),
    of(row?.firstElementChild, 'tools'),
    `tool row after the header: ${row?.previousElementSibling?.tagName ?? 'none'}`,
    of(line?.parentElement, 'path line'),
  ]
}

describe('the three shelves share one head (ShelfHead)', () => {
  for (const inFolder of [false, true]) {
    it(`draws the project Ablage, the Bürobibliothek and Meine Ablage alike on a desktop ${inFolder ? 'inside a folder' : 'at the top level'}`, () => {
      const heads = (['project', 'office', 'personal'] as const).map((shelf) => {
        const band = show(shelf, inFolder)
        const shape = skeleton(band)
        document.body.innerHTML = ''
        return shape
      })
      expect(heads[1]).toEqual(heads[0])
      expect(heads[2]).toEqual(heads[0])
      expect(heads[0]).toContain('tool row after the header: HEADER')
      expect(heads[0].find((entry) => entry.startsWith('tool row:'))).toMatch(/\bmt-6\b.*\bh-9\b/)
      expect(heads[0].includes('path line: none')).toBe(!inFolder)
      expect(heads[0].includes('crumb: none')).toBe(false)
    })
  }

  it('Meine Ablage stands still in a folder: its crumb, its title and count, its tool row, the folder on the path line under the head', () => {
    const band = show('personal', true)
    expect(within(band).getByTestId('page-header-crumb')).toHaveTextContent(/^Personal · Only you$/)
    expect(within(band).getByRole('heading', { level: 1 })).toHaveTextContent(/^Meine Ablage12$/)
    expect(within(band).getByTestId('shelf-head-count')).toHaveTextContent('12')
    expect(within(band).getByTestId('files-tool-row')).toContainElement(screen.getByRole('button', { name: 'Upload' }))
    expect(within(band).queryByTestId('page-header-up')).toBeNull()
    const line = screen.getByTestId('section-place-line')
    expect(band).not.toContainElement(line)
    expect(within(line).getByTestId('section-place-current')).toHaveTextContent('Index_C')
    expect(within(line).getByTestId('page-header-count')).toHaveTextContent('240 items')
  })

  for (const shelf of ['project', 'office', 'personal'] as const) {
    it(`on a phone the ${shelf} head takes the folder as its title, the phone trail as its crumb and ← as the line's start`, () => {
      media.phone = true
      const band = show(shelf, true)
      const heading = within(band).getByRole('heading', { level: 1 })
      expect(heading).toHaveAccessibleName(/^Index_C/)
      expect(within(heading).getByTestId('page-header-count')).toHaveClass('phone:hidden')
      expect(heading).toHaveAttribute('title', ['Index_C', '240 items'].join(CLAUSE_JOIN))
      expect(within(band).getByTestId('page-header-crumb')).toHaveTextContent(/^Phone trail$/)
      expect(within(band).getByTestId('page-header-up')).toHaveAccessibleName('Up to Planung')
      expect(screen.queryByTestId('section-place-line')).toBeNull()
      const rows = within(band).getAllByTestId('files-tool-row')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveClass('mt-4')
      expect(rows[0]).not.toHaveClass('h-9')
    })
  }
})
