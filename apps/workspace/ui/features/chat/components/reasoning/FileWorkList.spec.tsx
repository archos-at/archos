import type { ReactElement } from 'react'
import { render as baseRender, screen, within } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { useChatStore } from '../../store'
import type { FileWork } from '../../lib/file-work'
import { FileWorkList } from './FileWorkList'

const inGerman = (node: ReactElement) => (
  <I18nProvider initialLocale="de" fixedLocale>
    {node}
  </I18nProvider>
)

const render = (node: ReactElement) => {
  const view = baseRender(inGerman(node))
  return { ...view, rerender: (next: ReactElement) => view.rerender(inGerman(next)) }
}

const made: FileWork = {
  key: 'file:Raumbuch.xlsx',
  file: 'Raumbuch.xlsx',
  format: 'excel',
  outcome: 'made',
  phases: [
    { kind: 'prepare', state: 'done', attempts: 1 },
    { kind: 'make', state: 'done', attempts: 2, elapsedMs: 1200 },
  ],
  steps: 2,
  attempts: 2,
  elapsedMs: 1200,
  documents: [{ name: 'Raumliste.xlsx', documentId: 'doc-1' }],
}

afterEach(() => useChatStore.setState({ composerPrefill: null }))

describe('FileWorkList', () => {
  test('a made file is one line, its phases behind the toggle', async () => {
    render(<FileWorkList works={[made]} />)
    const row = screen.getByTestId('file-work-row')
    expect(row).toHaveTextContent('Raumbuch.xlsx erstellt')
    expect(row).toHaveTextContent(/2\sSchritte/)
    expect(screen.queryByTestId('file-work-phases')).toBeNull()

    await userEvent.click(screen.getByTestId('file-work-toggle'))

    const phases = within(screen.getByTestId('file-work-phases')).getAllByTestId('file-work-phase')
    expect(phases.map((phase) => phase.textContent)).toEqual([
      'Vorbereitet',
      'Erstellt',
      'Liegt als Entwurf in diesem Chat',
    ])
    expect(screen.getByTestId('file-work-inputs')).toHaveTextContent('Grundlage: Raumliste.xlsx')
    expect(screen.getByTestId('file-work-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  test('a retry is the same phase going on, with no error in sight', () => {
    render(
      <FileWorkList
        works={[
          {
            ...made,
            outcome: 'running',
            phases: [{ kind: 'make', state: 'running', attempts: 2 }],
            steps: 1,
          },
        ]}
      />
    )
    const row = screen.getByTestId('file-work-row')
    expect(row).toHaveTextContent('Excel-Tabelle wird erstellt: Raumbuch.xlsx')
    expect(row).toHaveTextContent('wird noch einmal versucht')
    expect(row.textContent).not.toMatch(/Fehler|fehlgeschlagen|error/i)
  })

  test('a final failure says what could not be made and puts a retry into the composer', async () => {
    render(
      <FileWorkList
        works={[
          {
            ...made,
            outcome: 'failed',
            failedKind: 'make',
            phases: [{ kind: 'make', state: 'failed', attempts: 3 }],
            steps: 1,
          },
        ]}
      />
    )
    expect(screen.getByTestId('file-work-row')).toHaveTextContent('Raumbuch.xlsx konnte nicht erstellt werden')
    expect(screen.getByTestId('file-work-failed')).toHaveTextContent('Die Datei ließ sich diesmal nicht fertigstellen.')

    await userEvent.click(screen.getByTestId('file-work-retry'))

    expect(useChatStore.getState().composerPrefill?.text).toBe('Bitte versuche noch einmal, Raumbuch.xlsx zu erstellen.')
  })

  test('a calculation shows its result and the documents it was made from', async () => {
    render(
      <FileWorkList
        works={[
          {
            key: 'calc:a',
            outcome: 'calculated',
            phases: [{ kind: 'calculate', state: 'done', attempts: 1 }],
            steps: 1,
            attempts: 1,
            documents: [{ name: 'Raumliste.xlsx', documentId: 'doc-1' }, { name: 'Notiz.md' }],
            result: '{"summe": 92.87}',
          },
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Berechnungen' })).toBeInTheDocument()
    expect(screen.getByTestId('file-work-row')).toHaveTextContent(/^Berechnung\s·\sErgebnis: summe 92,87$/)

    await userEvent.click(screen.getByTestId('file-work-toggle'))

    expect(screen.getAllByTestId('file-work-input').map((link) => link.getAttribute('aria-label'))).toEqual([
      'Raumliste.xlsx öffnen',
    ])
    expect(screen.getByTestId('file-work-inputs')).toHaveTextContent('Notiz.md')
  })

  test('a long run says how long, a short one does not', () => {
    const { rerender } = render(<FileWorkList works={[made]} />)
    expect(screen.getByTestId('file-work-meta').textContent).not.toMatch(/\ds/)
    rerender(<FileWorkList works={[{ ...made, elapsedMs: 14_000 }]} />)
    expect(screen.getByTestId('file-work-meta')).toHaveTextContent('14s')
  })

  test('nothing technical reaches the reader', async () => {
    render(<FileWorkList works={[made]} />)
    await userEvent.click(screen.getByTestId('file-work-toggle'))
    expect(screen.getByTestId('file-work').textContent).not.toMatch(/code|script|javascript|sandbox|isolate|stderr|execute/i)
  })
})
