import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'

import { render, screen } from '@/test-utils'
import { I18nProvider } from '@/i18n'
import { Button } from '@/components/ui/button'
import { CONTROL_HEIGHT } from '@/components/ui/control-height'
import { FilesHeaderControls } from './files-header-controls'

function german(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <I18nProvider initialLocale="de" fixedLocale>
      {ui}
    </I18nProvider>
  )
}

function controls(
  search: { opensSearch?: boolean; onSubmit: () => void; value?: string },
  phone = false,
  neighbours: { filter?: (compact: boolean) => ReactElement; upload?: ReactElement } = {}
): ReactElement {
  return (
    <FilesHeaderControls
      phone={phone}
      view="list"
      onViewChange={() => {}}
      renderFilter={neighbours.filter ?? (() => null)}
      upload={neighbours.upload}
      search={{ value: search.value ?? '', onChange: () => {}, onSubmit: search.onSubmit, onClear: () => {}, opensSearch: search.opensSearch }}
    />
  )
}

describe('FilesHeaderControls', () => {
  it('is one way into a shelf’s search: the field says Enter searches everything, and Enter does', async () => {
    const onSubmit = vi.fn()
    german(controls({ opensSearch: true, onSubmit, value: 'EP-03' }))
    const field = screen.getByRole('textbox', { name: 'Dateien durchsuchen' })
    expect(field).toHaveAttribute('placeholder', 'Filtern, Enter sucht alles…')
    // No second door beside it.
    expect(screen.queryByRole('button', { name: 'Suche' })).toBeNull()
    await userEvent.type(field, '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps the short placeholder on a phone and where the shelf has no search', () => {
    const { unmount } = german(controls({ opensSearch: true, onSubmit: () => {} }, true))
    expect(screen.getByRole('textbox', { name: 'Dateien durchsuchen' })).toHaveAttribute('placeholder', 'Suchen…')
    unmount()
    german(controls({ onSubmit: () => {} }))
    expect(screen.getByRole('textbox', { name: 'Dateien durchsuchen' })).toHaveAttribute('placeholder', 'Suchen…')
  })

  // Ticket #38, topic 11: the field stood 4px taller than the Filter and Hochladen beside it.
  it('stands the search exactly as tall as the buttons beside it, wide and on a phone', () => {
    const filter = (compact: boolean): ReactElement => (
      <Button size={compact ? 'icon' : 'sm'} data-testid="filter">Filter</Button>
    )
    const upload = <Button size="sm" data-testid="upload">Hochladen</Button>
    const { unmount } = german(controls({ onSubmit: () => {} }, false, { filter, upload }))
    const field = screen.getByRole('textbox', { name: 'Dateien durchsuchen' })
    for (const height of CONTROL_HEIGHT.sm.split(' ')) {
      expect(field).toHaveClass(height)
      expect(screen.getByTestId('filter')).toHaveClass(height)
      expect(screen.getByTestId('upload')).toHaveClass(height)
    }
    expect(field).not.toHaveClass('h-9')
    unmount()
    // A phone's row is the filter glyph and ⋯, `icon` buttons: 36px, and the field is too.
    german(controls({ onSubmit: () => {} }, true, { filter }))
    expect(screen.getByRole('textbox', { name: 'Dateien durchsuchen' })).toHaveClass('h-9')
    expect(screen.getByTestId('filter')).toHaveClass('size-9')
  })
})
