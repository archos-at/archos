import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/i18n'
import { DeleteDocumentDialog } from './delete-document-dialog'
import type { DocumentScope } from './document-scope'

const actions = (erases: boolean) => ({ name: 'Leitfaden.pdf', isDeleting: false, erases, remove: async () => true })

function renderDialog(scope: DocumentScope, erases: boolean) {
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <DeleteDocumentDialog open onOpenChange={() => {}} scope={scope} actions={actions(erases)} />
    </I18nProvider>
  )
}

describe('DeleteDocumentDialog', () => {
  it('tells a Meine Ablage reader that the file is gone for good, because that shelf has no bin', () => {
    renderDialog('personal', true)
    expect(screen.getByText(/Meine Ablage hat keinen Papierkorb/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Endgültig löschen' })).toBeInTheDocument()
  })

  it('keeps the held-file sentence for a held project file', () => {
    renderDialog('files', true)
    expect(screen.getByText(/zurückgehaltene Datei/)).toBeInTheDocument()
    expect(screen.queryByText(/Meine Ablage hat keinen Papierkorb/)).toBeNull()
  })
})
