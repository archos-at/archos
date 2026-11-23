import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@/test-utils'
import type { NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { NormOffer, PlaceProjectNormsResponse, ProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'
import { PRODUCT_NAME } from '@/lib/brand'
import { I18nProvider } from '@/i18n'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'
import { capturePosthog } from '@/lib/analytics/posthog'
import { ProjectNormNotices } from './project-norm-notices'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const PROJECT = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const DOC = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const OFFER: NormOffer = {
  documentId: DOC,
  fileName: 'OENORM_B_1600_2017-04-15.pdf',
  folderId: null,
  designation: 'ÖNORM B 1600',
  kind: 'technical_standard',
  editionLabel: '2017-04-15',
}

function norms(extra: Partial<ProjectNormsResponse> = {}): ProjectNormsResponse {
  return {
    canManageOfficeShelf: true,
    canWrite: true,
    offers: [OFFER],
    references: [],
    nextCursor: null,
    ...extra,
  }
}

const placed = (extra: Partial<PlaceProjectNormsResponse> = {}): PlaceProjectNormsResponse => ({
  destination: 'office_shelf',
  visibility: 'office',
  placements: [],
  notified: 1,
  noDecider: null,
  ...extra,
})

function server(listed: ProjectNormsResponse[], answer: PlaceProjectNormsResponse = placed()): { run: NormsFetch; posted: unknown[] } {
  const posted: unknown[] = []
  let reads = 0
  const run: NormsFetch = async (_path, init) => {
    if (init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return Response.json(answer)
    }
    const body = listed[Math.min(reads, listed.length - 1)]
    reads += 1
    return Response.json(body)
  }
  return { run, posted }
}

beforeEach(() => {
  vi.clearAllMocks()
  toast.mockReset()
})

const notices = (run: NormsFetch, awaiting?: ReadonlySet<string>, onAwaited?: (ids: readonly string[]) => void) => (
  <I18nProvider initialLocale="de" fixedLocale>
    <NormDialogProvider dialog={NormDialog}>
      <ProjectNormNotices projectId={PROJECT} folderId={null} run={run} awaiting={awaiting} onAwaited={onAwaited} />
    </NormDialogProvider>
  </I18nProvider>
)

const confirmIn = async (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }))

describe('the project banner for norms that sit only in this project', () => {
  it('opens the norm dialog to move them, and files them confirmed with the values the person saw', async () => {
    const { run, posted } = server([norms(), norms({ offers: [] })])
    render(notices(run))

    expect(await screen.findByText(`${PRODUCT_NAME} schlägt die Büroablage vor.`)).toBeInTheDocument()
    expect(screen.getByText(/ÖNORM B 1600 gibt es bisher nur in diesem Projekt/)).toHaveTextContent('Sichtbar wäre sie dann für alle im Büro.')
    await userEvent.click(screen.getByRole('button', { name: 'In die Büroablage verschieben' }))

    const dialog = await screen.findByTestId('norm-dialog')
    expect(within(dialog).getByRole('textbox', { name: `Bezeichnung: ${OFFER.fileName}` })).toHaveValue('ÖNORM B 1600')
    expect(within(dialog).getByRole('textbox', { name: `Ausgabe: ${OFFER.fileName}` })).toHaveValue('2017-04-15')
    expect(within(dialog).getByRole('radio', { name: /^Büroablage \(empfohlen\)/ })).toBeChecked()
    expect(posted).toEqual([])
    await confirmIn(dialog)

    await waitFor(() =>
      expect(posted).toEqual([
        {
          destination: 'office_shelf',
          documents: [{ documentId: DOC, values: { kind: 'technical_standard', designation: 'ÖNORM B 1600', editionLabel: '2017-04-15' } }],
          visibility: 'office',
          confirm: true,
        },
      ])
    )
    expect(toast.success).toHaveBeenCalledWith('Bestätigt und nach Büroablage › Normen & Richtlinien gebracht. Das Projekt behält einen Verweis.')
    await waitFor(() => expect(screen.queryByTestId('project-norm-offer')).not.toBeInTheDocument())
  })

  it('moves nothing while the edition is missing, and says so', async () => {
    const { run, posted } = server([norms({ offers: [{ ...OFFER, editionLabel: null }] })])
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'In die Büroablage verschieben' }))
    await confirmIn(await screen.findByTestId('norm-dialog'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tragen Sie die Ausgabe ein. Ohne Ausgabe lässt sich die Norm nicht bestätigen.'))
    expect(posted).toEqual([])
    expect(screen.getByTestId('norm-dialog')).toBeInTheDocument()
  })

  it('suggests them with the values the person saw, for someone who may not manage it', async () => {
    const { run, posted } = server([norms({ canManageOfficeShelf: false })], placed({ destination: 'suggest' }))
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Für die Büroablage vorschlagen' }))
    const dialog = await screen.findByTestId('norm-dialog')
    expect(within(dialog).getByRole('radio', { name: /^Für die Büroablage vorschlagen/ })).toBeChecked()
    await confirmIn(dialog)
    await waitFor(() =>
      expect(posted).toEqual([
        {
          destination: 'suggest',
          documents: [{ documentId: DOC, values: { kind: 'technical_standard', designation: 'ÖNORM B 1600', editionLabel: '2017-04-15' } }],
          visibility: 'office',
        },
      ])
    )
    expect(toast.success).toHaveBeenCalledWith('Vorschlag an die Büroverwaltung geschickt. Bis dahin bleiben die Normen hier.')
  })

  it('says plainly when nobody here may decide a suggestion, names who could, and keeps the offer', async () => {
    const refused = { documentId: DOC, outcome: 'refused' as const, officeDocumentId: null, entryId: null, referenceId: null, proposalId: null, reason: 'Nobody' }
    const { run } = server(
      [norms({ canManageOfficeShelf: false })],
      placed({ destination: 'suggest', notified: 0, placements: [refused], noDecider: { managers: ['Bernd Huber'] } })
    )
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Für die Büroablage vorschlagen' }))
    await confirmIn(await screen.findByTestId('norm-dialog'))

    const said =
      'Niemand, der hier schreiben darf, darf auch die Büroablage verwalten, also kann niemand den Vorschlag entscheiden. ' +
      'Entscheiden könnten Bernd Huber, sobald sie in diesem Projekt schreiben dürfen. Die Normen bleiben hier.'
    expect(await screen.findByRole('alert')).toHaveTextContent(said)
    expect(toast.warning).toHaveBeenCalledWith(said)
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('project-norm-offer')).toBeInTheDocument()
  })

  it('says so when nobody in the office manages the office shelf', async () => {
    const { run } = server([norms({ canManageOfficeShelf: false })], placed({ destination: 'suggest', notified: 0, noDecider: { managers: [] } }))
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Für die Büroablage vorschlagen' }))
    await confirmIn(await screen.findByTestId('norm-dialog'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Im Büro darf niemand die Büroablage verwalten')
  })

  it('keeps them here with „Hier lassen“, which widens nothing', async () => {
    const { run, posted } = server([norms()])
    render(notices(run))
    await userEvent.click(await screen.findByRole('button', { name: 'Hier lassen' }))
    await waitFor(() => expect(posted).toEqual([{ destination: 'project', documents: [{ documentId: DOC }] }]))
  })

  it('shows the references the folder keeps: the moved copy’s entry, a copy no longer a norm as its Büroablage file, and a removed one', async () => {
    const reference = { folderId: null, placedAs: 'moved' as const, officeDocumentId: null, entryId: null, createdAt: '2026-11-19T10:00:00Z', createdBy: 'user_1' }
    const { run } = server([
      norms({
        offers: [],
        references: [
          { ...reference, id: 'r1', fileName: 'OENORM_B_2320.pdf', state: 'in_office_shelf', officeDocumentId: DOC, entryId: 'edition_b2320' },
          { ...reference, id: 'r3', fileName: 'OENORM_B_5371.pdf', state: 'unlisted', officeDocumentId: 'office-doc-5371' },
          { ...reference, id: 'r2', fileName: 'OENORM_B_3691.pdf', state: 'removed' },
        ],
      }),
    ])
    render(notices(run))
    const lines = await screen.findAllByTestId('shelf-reference')
    expect(lines.map((line) => line.textContent)).toEqual([
      'OENORM_B_2320.pdfVerweis · liegt in der BüroablageÖffnen',
      'OENORM_B_5371.pdfVerweis · liegt in der Büroablage, nicht mehr als NormÖffnen',
      'OENORM_B_3691.pdfVerweis · aus der Büroablage entfernt',
    ])
    expect(screen.getByRole('link', { name: '„OENORM_B_2320.pdf“ in der Büroablage öffnen' })).toHaveAttribute('href', '/app/base-knowledge?entry=edition_b2320')
    expect(screen.getByRole('link', { name: '„OENORM_B_5371.pdf“ in der Büroablage öffnen' })).toHaveAttribute('href', '/app/office-shelf?doc=office-doc-5371')
    expect(screen.queryByTestId('project-norm-offer')).not.toBeInTheDocument()
  })
})

describe('the norm dialog after a project upload', () => {
  it('opens for the norms just uploaded once they are offered, and keeps them in the project on „Nur dieses Projekt“', async () => {
    const onAwaited = vi.fn()
    const { run, posted } = server([norms(), norms({ offers: [] })], placed({ destination: 'project', visibility: 'project' }))
    render(notices(run, new Set([DOC]), onAwaited))

    const dialog = await screen.findByTestId('norm-dialog')
    expect(onAwaited).toHaveBeenCalledWith([DOC])
    expect(within(dialog).getByText('Wohin gehört diese Norm?')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Nur dieses Projekt/ }))
    await confirmIn(dialog)

    await waitFor(() => expect(posted).toEqual([{ destination: 'project', documents: [{ documentId: DOC }] }]))
    expect(toast.success).toHaveBeenCalledWith(`Bleiben im Projekt. ${PRODUCT_NAME} fragt für diese Normen nicht mehr.`)
  })

  it('keeps an uploaded file set to „Keine Norm“ an ordinary project file while the others move', async () => {
    const second: NormOffer = {
      ...OFFER,
      documentId: '7d1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
      fileName: 'Weisung_MA37.pdf',
      designation: null,
      kind: 'authority_directive',
      editionLabel: '2024',
    }
    const { run, posted } = server([norms({ offers: [OFFER, second] })])
    render(notices(run, new Set([DOC, second.documentId])))
    const dialog = await screen.findByTestId('norm-dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Art: Weisung_MA37.pdf' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Keine Norm' }))
    await confirmIn(dialog)

    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[0]).toEqual({ destination: 'project', documents: [{ documentId: second.documentId }] })
    expect(posted[1]).toMatchObject({ destination: 'office_shelf', confirm: true, documents: [{ documentId: DOC }] })
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_shown', { rows: 2, source: 'project_upload' })
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_settled', {
      confirmed: 1,
      not_norm: 1,
      later: 0,
      edition_added: 0,
      duplicate_removed: 0,
      source: 'project_upload',
    })
  })

  it('leaves the offer on the banner on „Später“', async () => {
    const { run, posted } = server([norms()])
    render(notices(run, new Set([DOC])))
    await userEvent.click(within(await screen.findByTestId('norm-dialog')).getByRole('button', { name: 'Später' }))
    expect(toast).toHaveBeenCalledWith('Die Normen bleiben vorerst nur in diesem Projekt. Der Hinweis über den Dateien bietet die Büroablage weiter an.')
    expect(posted).toEqual([])
    expect(capturePosthog).toHaveBeenCalledWith('norm_dialog_settled', expect.objectContaining({ later: 1, confirmed: 0, source: 'project_upload' }))
    await waitFor(() => expect(screen.queryByTestId('norm-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('project-norm-offer')).toBeInTheDocument()
  })

  it('stays shut for norms nobody just uploaded here', async () => {
    const { run } = server([norms()])
    render(notices(run, new Set(['another-upload'])))
    expect(await screen.findByTestId('project-norm-offer')).toBeInTheDocument()
    expect(screen.queryByTestId('norm-dialog')).not.toBeInTheDocument()
  })
})
