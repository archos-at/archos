import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Project } from '@/lib/db/schema/projects'
import { overviewOrder, ProjectOverview } from './project-overview'

let pathname = '/app/projects/p1/files'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock('./create-project-form', () => ({ CreateProjectForm: () => <div data-testid="create-project-form" /> }))

const fact = (value: string) => ({ value, confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-11-01T00:00:00Z' })
const project = (id: string, name: string, over: Partial<Project> = {}, facts: Record<string, string> = {}): Project =>
  ({
    id,
    organizationId: 'org-1',
    name,
    collectionName: `proj_${id}`,
    createdBy: 'user-1',
    workosResourceId: null,
    status: 'active',
    profile: { facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, fact(v)])), goals: {}, unknowns: [], assumptions: {} },
    profileUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as Project

const PROJECTS = [
  project('p3', 'Volksschule Mühlgasse', { status: 'paused' }),
  project('p1', 'Wohnbau Seestadt', {}, { site_address: 'Seestadtstraße 1, Wien', project_phase: 'Einreichplanung' }),
  project('p4', 'Dachausbau Kaiserstraße', { status: 'closed' }),
  project('p2', 'Bürohaus Lände 3', {}, { site_address: 'Erdberger Lände 3, Wien' }),
]

const show = (props: Partial<Parameters<typeof ProjectOverview>[0]> = {}) =>
  render(
    <ProjectOverview
      projects={PROJECTS}
      docCounts={{ p1: 62, p2: 1 }}
      viewerActivity={{ p2: '2026-11-20T10:00:00Z', p1: '2026-11-10T10:00:00Z' }}
      mailWaiting={{ p1: 3 }}
      {...props}
    />
  )

const cards = () => screen.getAllByTestId('project-overview-card')

describe('the project overview that replaces the start page', () => {
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

  test('says where a project is and in which phase, or that it rests or is done', () => {
    show()
    const lines = screen.getAllByTestId('project-overview-line').map((line) => line.textContent)
    expect(lines).toEqual(['Erdberger Lände 3, Wien', 'Seestadtstraße 1, Wien · Einreichplanung', 'Paused', 'Closed'])
  })

  test('keeps what the grid showed: documents, recent activity, mail waiting, and the way to the project’s own Übersicht', () => {
    show()
    const seestadt = cards()[1]!
    expect(seestadt).toHaveTextContent('62 documents')
    expect(within(seestadt).getByTestId('project-mail-waiting')).toHaveAttribute('href', '/app/projects/p1/files/mail')
    expect(within(seestadt).getByRole('link', { name: /overview.*Wohnbau Seestadt/i })).toHaveAttribute('href', '/app/projects/p1/settings')
    expect(within(seestadt).getByRole('time')).toBeInTheDocument()
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
    expect(cards()).toHaveLength(1)
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
})
