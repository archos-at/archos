import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test-utils'
import type { NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { PlaceProjectNormsResponse, ProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'
import { PRODUCT_NAME } from '@/lib/brand'
import { I18nProvider } from '@/i18n'
import { ProjectNormNotices } from './project-norm-notices'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PROJECT = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const DOC = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

function norms(extra: Partial<ProjectNormsResponse> = {}): ProjectNormsResponse {
  return {
    canManageOfficeShelf: true,
    canWrite: true,
    offers: [{ documentId: DOC, fileName: 'OENORM_B_1600.pdf', folderId: null, designation: 'ÖNORM B 1600' }],
    references: [],
    nextCursor: null,
    ...extra,
  }
}

const placed: PlaceProjectNormsResponse = { destination: 'office_shelf', visibility: 'office', placements: [], notified: 0 }

function server(listed: ProjectNormsResponse[]): { run: NormsFetch; posted: unknown[] } {
  const posted: unknown[] = []
  let reads = 0
  const run: NormsFetch = async (_path, init) => {
    if (init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return Response.json(placed)
    }
    const body = listed[Math.min(reads, listed.length - 1)]
    reads += 1
    return Response.json(body)
  }
  return { run, posted }
}

beforeEach(() => vi.clearAllMocks())

const notices = (run: NormsFetch) => (
  <I18nProvider initialLocale="de" fixedLocale>
    <ProjectNormNotices projectId={PROJECT} folderId={null} run={run} />
  </I18nProvider>
)

describe('the project banner for norms that sit only in this project', () => {
  it('offers to move them for someone who manages the office shelf, saying the office will see them', async () => {
    const { run, posted } = server([norms(), norms({ offers: [] })])
    render(notices(run))

    expect(await screen.findByText(`${PRODUCT_NAME} schlägt die Büroablage vor.`)).toBeInTheDocument()
    expect(screen.getByText(/ÖNORM B 1600 gibt es bisher nur in diesem Projekt/)).toHaveTextContent('Sichtbar wäre sie dann für alle im Büro.')
    await userEvent.click(screen.getByRole('button', { name: 'In die Büroablage verschieben' }))

    await waitFor(() => expect(posted).toEqual([{ destination: 'office_shelf', documents: [{ documentId: DOC }], visibility: 'office' }]))
    await waitFor(() => expect(screen.queryByTestId('project-norm-offer')).not.toBeInTheDocument())
  })

  it('offers to suggest them for someone who may not manage it', async () => {
    const { run, posted } = server([norms({ canManageOfficeShelf: false })])
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Für die Büroablage vorschlagen' }))
    await waitFor(() => expect(posted).toEqual([{ destination: 'suggest', documents: [{ documentId: DOC }], visibility: 'office' }]))
  })

  it('keeps them here with „Hier lassen“, which widens nothing', async () => {
    const { run, posted } = server([norms()])
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Hier lassen' }))
    await waitFor(() => expect(posted).toEqual([{ destination: 'project', documents: [{ documentId: DOC }] }]))
  })

  it('shows the references the folder keeps, and one whose copy was removed as removed', async () => {
    const reference = { folderId: null, placedAs: 'moved' as const, officeDocumentId: null, createdAt: '2026-11-19T10:00:00Z', createdBy: 'user_1' }
    const { run } = server([
      norms({
        offers: [],
        references: [
          { ...reference, id: 'r1', fileName: 'OENORM_B_2320.pdf', state: 'in_office_shelf', officeDocumentId: DOC },
          { ...reference, id: 'r2', fileName: 'OENORM_B_3691.pdf', state: 'removed' },
        ],
      }),
    ])
    render(notices(run))
    const lines = await screen.findAllByTestId('shelf-reference')
    expect(lines.map((line) => line.textContent)).toEqual([
      'OENORM_B_2320.pdfVerweis · liegt in der BüroablageÖffnen',
      'OENORM_B_3691.pdfVerweis · aus der Büroablage entfernt',
    ])
    expect(screen.getByRole('link', { name: '„OENORM_B_2320.pdf“ in der Büroablage öffnen' })).toHaveAttribute('href', '/app/base-knowledge')
    expect(screen.queryByTestId('project-norm-offer')).not.toBeInTheDocument()
  })
})
