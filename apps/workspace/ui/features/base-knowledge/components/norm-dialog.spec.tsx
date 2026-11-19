import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import type { NormProposal, NormRecognition } from '@/lib/base-knowledge/wire'
import { NormDialog } from './norm-dialog'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const proposal = (entryId: string, overrides: Partial<NormProposal> = {}): NormProposal => ({
  entryId,
  documentId: `doc-${entryId}`,
  fileName: `${entryId}.pdf`,
  kind: 'technical_standard',
  designation: 'ÖNORM B 8110-3',
  editionLabel: '2020-03-15',
  topicId: null,
  editionOf: null,
  duplicate: false,
  ...overrides,
})

const RECOGNITION: NormRecognition = {
  proposals: [
    proposal('plan', { designation: null, editionLabel: null, fileName: 'Haus_A_Weisung_Entwurf.pdf', kind: 'authority_directive' }),
    proposal('dup', {
      designation: 'ÖNORM B 1600',
      editionLabel: '2017-04-01',
      editionOf: { entryId: 'edition_b1600', designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
      duplicate: true,
    }),
  ],
  plain: [
    { documentId: 'doc-a', fileName: 'a.pdf', folderId: null, folderPath: null, platformHeld: false },
    { documentId: 'doc-oib', fileName: 'OIB-RL 4.pdf', folderId: 'f-1', folderPath: 'Pläne/Einreichung', platformHeld: true },
  ],
  topics: { rootId: 'root', folders: [], nextCursor: null },
}

function renderDialog(onSettled = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <NormDialog recognition={RECOGNITION} onClose={onClose} onSettled={onSettled} />
    </I18nProvider>,
  )
  return { onSettled, onClose }
}

afterEach(() => {
  vi.unstubAllGlobals()
  toast.mockReset()
  for (const fn of [toast.success, toast.warning, toast.error]) fn.mockReset()
})

describe('NormDialog', () => {
  it('says a duplicate will not be filed twice, and where the other files lie', () => {
    renderDialog()
    const dialog = screen.getByTestId('norm-dialog')
    expect(within(dialog).getByTestId('norm-dialog-info').textContent).toBe('diese Ausgabe liegt schon in der Büroablage und wird nicht doppelt abgelegt')
    expect(within(dialog).getByTestId('norm-dialog-plain').textContent).toMatch(
      /^2 weitere Dateien sind keine Normen und liegen, wo sie hochgeladen wurden\. Darunter eine Richtlinie, die \S+ schon kennt\.$/,
    )
  })

  it('lays the norms out as a table: one row each, its designation a labelled field in its own column, the edition note spanning under it', () => {
    renderDialog()
    const table = within(screen.getByTestId('norm-dialog')).getByRole('table', { name: '2 Normen erkannt' })
    expect(within(table).getAllByRole('columnheader').map((head) => head.textContent)).toEqual(['Art', 'Bezeichnung', 'Ausgabe', 'Thema'])
    const rows = within(table).getAllByTestId('norm-dialog-row')
    expect(rows).toHaveLength(RECOGNITION.proposals.length)
    for (const [index, row] of rows.entries()) {
      const { fileName } = RECOGNITION.proposals[index]
      const cells = within(row).getAllByRole('cell')
      const designation = within(cells[1]).getByRole('textbox', { name: `Bezeichnung: ${fileName}` })
      expect(designation).toBeVisible()
      expect(within(row).getByRole('textbox', { name: `Ausgabe: ${fileName}` }).closest('[role=cell]')).not.toBe(cells[1])
    }
    const note = within(rows[1]).getByTestId('norm-dialog-info')
    expect(note.getAttribute('role')).toBe('cell')
    expect(note.getAttribute('aria-colspan')).toBe('4')
    expect(within(rows[1]).getByRole('textbox', { name: 'Bezeichnung: dup.pdf' })).toHaveAccessibleDescription(note.textContent!)
    expect(screen.getByTestId('norm-dialog').className).toContain('sm:max-w-4xl')
  })

  it('asks for a designation where the file name gave none', () => {
    renderDialog()
    expect(screen.getByRole('textbox', { name: 'Bezeichnung: Haus_A_Weisung_Entwurf.pdf' })).toHaveAttribute('placeholder', 'Bezeichnung eintragen')
  })

  it('drops a row set to Keine Norm and sums up what happened', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        results: [
          { entryId: 'plan', outcome: 'not_norm', error: null },
          { entryId: 'dup', outcome: 'duplicate_removed', error: null },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { onSettled } = renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Art: Haus_A_Weisung_Entwurf.pdf' }))
    await user.click(await screen.findByRole('option', { name: 'Keine Norm' }))
    expect((screen.getByRole('textbox', { name: 'Ausgabe: Haus_A_Weisung_Entwurf.pdf' }) as HTMLInputElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))

    await waitFor(() => expect(onSettled).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      rows: [
        { entryId: 'plan', notNorm: true },
        { entryId: 'dup', editionLabel: '2017-04-01' },
      ],
    })
    expect(toast.success).toHaveBeenCalledWith('1 als normale Datei behalten, 1 Duplikat verworfen')
  })

  it('leaves everything proposed on Später', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Später' }))
    expect(onClose).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('warten unter Normen & Richtlinien auf Bestätigung'))
  })
})
