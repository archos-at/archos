import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Project } from '@/lib/db/schema/projects'
import { makeProject } from '@/test-utils/db-fixtures'
import { overviewOrder } from '@/lib/projects/overview-order'
import { ProjectOverview } from './project-overview'

let pathname = '/app/projects/p1/files'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock('./create-project-form', () => ({ CreateProjectForm: () => <div data-testid="create-project-form" /> }))

const fact = (value: string) => ({ value, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '2026-11-01T00:00:00Z' })
const project = (id: string, name: string, over: Partial<Project> = {}, facts: Record<string, string> = {}): Project =>
  makeProject({
    id,
    name,
    profile: { facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, fact(v)])), goals: {}, unknowns: [], assumptions: {} },
    profileUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  })

const PROJECTS = [
  project('p3', 'Volksschule Mühlgasse', { status: 'paused' }),
  project('p1', 'Wohnbau Seestadt', {}, { site_address: 'Seestadtstraße 1, 1220 Wien', project_phase: 'Einreichplanung' }),
  project('p4', 'Dachausbau Kaiserstraße', { status: 'closed' }),
  project('p2', 'Bürohaus Lände 3', {}, { site_address: 'Erdberger Lände 3, Wien' }),
]

const show = (props: Partial<Parameters<typeof ProjectOverview>[0]> = {}) =>
  render(
    <ProjectOverview
      projects={PROJECTS}
      viewerActivity={{ p2: '2026-11-20T10:00:00Z', p1: '2026-11-10T10:00:00Z' }}
      {...props}
    />
  )

const cards = () => screen.getAllByTestId('project-overview-card')

describe('the project overview that replaces the start page', () => {
  test('on a phone the title is never cut or run under: the header wraps „Neues Projekt“ under it', () => {
    show()
    const header = screen.getByTestId('project-overview-header')
    expect(header).toHaveClass('flex-wrap')
    const title = within(header).getByRole('heading', { level: 1 })
    expect(title.className).not.toMatch(/min-w-0|truncate/)
    expect(title.nextElementSibling).toHaveClass('order-last', 'sm:order-none')
  })

  test('lists every project the person may open, paused and closed ones too, active first by recent activity', () => {
    show()
    expect(cards().map((card) => within(card).getAllByRole('link')[0]!.getAttribute('aria-label'))).toEqual([
      'Open Bürohaus Lände 3',
      'Open Wohnbau Seestadt',
      'Open Volksschule Mühlgasse',
      'Open Dachausbau Kaiserstraße',
    ])
    expect(cards().map((card) => card.getAttribute('data-status'))).toEqual(['active', 'active', 'paused', 'closed'])
  })

  test('says in one line the city and the phase, or that a project rests or is done', () => {
    show()
    const lines = screen.getAllByTestId('project-overview-line').map((line) => line.textContent)
    expect(lines).toEqual(['Wien', 'Wien · Einreichplanung', 'Paused', 'Closed'])
  })

  test('holds only the name, the gear to the project settings and that line: no footer', () => {
    show()
    const seestadt = cards()[1]!
    const gear = within(seestadt).getByRole('link', { name: 'Project settings of Wohnbau Seestadt' })
    expect(gear).toHaveAttribute('href', '/app/projects/p1/settings')
    expect(gear).toHaveAttribute('title', 'Project settings')
    expect(within(seestadt).getAllByRole('link')).toHaveLength(2)
    expect(within(seestadt).queryByRole('time')).not.toBeInTheDocument()
    expect(seestadt).not.toHaveTextContent(/documents?/)
  })

  test('marks the project the person is in', () => {
    show()
    expect(cards()[1]).toHaveAttribute('aria-current', 'page')
    expect(cards()[0]).not.toHaveAttribute('aria-current')
  })

  test('searches, and says when nothing matches', async () => {
    show()
    const search = screen.getByRole('textbox', { name: /search projects/i })
    await userEvent.type(search, 'seestadt')
    expect(screen.queryAllByTestId('project-overview-card')).toHaveLength(0)
    expect(screen.getAllByTestId('project-overview-row')).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(screen.queryAllByTestId('project-overview-card')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
  })

  test('creates a project from its header, and opens the dialog itself for ?new=1', () => {
    show({ autoOpenCreate: true })
    expect(screen.getByRole('heading', { level: 1, name: 'Project overview', hidden: true })).toBeInTheDocument()
    expect(screen.getByTestId('create-project-form')).toBeInTheDocument()
  })

  test('an office with no project yet still gets the way to make one', () => {
    pathname = '/app/personal/chat'
    show({ projects: [] })
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  test('orders without moving a paused project ahead of an active one', () => {
    expect(overviewOrder(PROJECTS, {}).map((p) => p.id).slice(2)).toEqual(['p3', 'p4'])
  })

  test('the six projects worked in last stand as cards, every other one follows as a row', () => {
    const many = Array.from({ length: 9 }, (_, i) => project(`m${i}`, `Projekt ${i}`, { createdAt: new Date(Date.UTC(2026, 0, 1 + i)) }))
    show({ projects: many, viewerActivity: {} })
    expect(cards().map((card) => within(card).getAllByRole('link')[0]!.getAttribute('aria-label'))).toEqual(
      ['8', '7', '6', '5', '4', '3'].map((n) => `Open Projekt ${n}`)
    )
    const more = screen.getByRole('region', { name: 'More projects' })
    const rows = within(more).getAllByTestId('project-overview-row')
    expect(rows.map((row) => within(row).getAllByRole('link')[0]!.getAttribute('aria-label'))).toEqual(
      ['2', '1', '0'].map((n) => `Open Projekt ${n}`)
    )
  })

  test('a row holds the name, its line, when it was last worked in and the gear, always in view', () => {
    const many = [...PROJECTS, ...Array.from({ length: 4 }, (_, i) => project(`m${i}`, `Projekt ${i}`))]
    show({ projects: many })
    const rows = screen.getAllByTestId('project-overview-row')
    const closed = rows.find((row) => row.dataset.status === 'closed')!
    expect(within(closed).getByTestId('project-overview-line')).toHaveTextContent('Closed')
    expect(within(closed).getByRole('time')).toBeInTheDocument()
    const gear = within(closed).getByRole('link', { name: 'Project settings of Dachausbau Kaiserstraße' })
    expect(gear).toHaveAttribute('href', '/app/projects/p4/settings')
    expect(gear.className).not.toMatch(/opacity-0/)
  })

  test('a search runs over cards and rows alike and shows the matches as rows', async () => {
    const many = Array.from({ length: 9 }, (_, i) => project(`m${i}`, `Projekt ${i}`, { createdAt: new Date(Date.UTC(2026, 0, 1 + i)) }))
    show({ projects: many, viewerActivity: {} })
    await userEvent.type(screen.getByRole('textbox', { name: /search projects/i }), 'projekt')
    expect(screen.queryAllByTestId('project-overview-card')).toHaveLength(0)
    const matches = screen.getByRole('list', { name: 'Matching projects' })
    expect(within(matches).getAllByTestId('project-overview-row')).toHaveLength(9)
    await userEvent.clear(screen.getByRole('textbox', { name: /search projects/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /search projects/i }), 'projekt 0')
    expect(screen.getAllByTestId('project-overview-row').map((row) => row.textContent)).toEqual([expect.stringContaining('Projekt 0')])
  })

  test('a card without a line is as tall as its name: no fixed height', () => {
    show()
    for (const card of cards()) expect(card.className).not.toMatch(/\bh-\[/)
    expect(cards()[0]).toHaveClass('rounded-surface')
  })

  test('the title and the search stand still; the cards, the list and what follows scroll under them, faded at both edges', () => {
    show({ after: <section data-testid="after-slot" /> })
    const top = screen.getByTestId('project-overview-top')
    const scroll = screen.getByTestId('project-overview-scroll')
    expect(within(top).getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(within(top).getByRole('textbox', { name: /search projects/i })).toBeInTheDocument()
    expect(scroll).toHaveClass('overflow-y-auto', 'scroll-fade-y', 'min-h-0', 'flex-1')
    expect(within(scroll).getByTestId('project-overview-grid')).toBeInTheDocument()
    expect(within(scroll).getByTestId('after-slot')).toBeInTheDocument()
    expect(top).not.toContainElement(scroll)
  })
})
