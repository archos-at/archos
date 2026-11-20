import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BASE_KNOWLEDGE_ENTRIES, BASE_KNOWLEDGE_FOLDERS, BASE_KNOWLEDGE_TERRITORIES } from '@/app/dev/_fixtures/base-knowledge'
import { countByFolder, countEntries } from '@/lib/base-knowledge/office/listing'
import { EntryList } from './entry-list'

const layout = vi.hoisted(() => ({ phone: false }))
vi.mock('@/features/documents/hooks/use-phone-layout', () => ({ usePhoneLayout: () => layout.phone }))

function renderList(onFilters = vi.fn()) {
  render(
    <I18nProvider initialLocale="de" fixedLocale>
      <TooltipProvider>
        <EntryList
          list={{
            canManage: true,
            counts: countEntries(BASE_KNOWLEDGE_ENTRIES),
            territories: BASE_KNOWLEDGE_TERRITORIES,
            folderCounts: countByFolder(BASE_KNOWLEDGE_ENTRIES),
            entries: BASE_KNOWLEDGE_ENTRIES,
            nextCursor: null,
          }}
          folders={BASE_KNOWLEDGE_FOLDERS}
          filters={{ folderId: null, attention: null, kind: null, search: '' }}
          onFilters={onFilters}
          onReset={vi.fn()}
          selected={new Set()}
          onSelect={vi.fn()}
          onClearSelection={vi.fn()}
          onBulk={vi.fn()}
          onOpen={vi.fn()}
          loadingMore={false}
          onLoadMore={vi.fn()}
        />
      </TooltipProvider>
    </I18nProvider>,
  )
  return onFilters
}

const standOfRow = (designation: string) => {
  const row = screen.getAllByTestId('base-knowledge-row').find((candidate) => within(candidate).queryByText(designation))
  return within(row!).getByTestId('base-knowledge-status').textContent
}

describe('the norms list', () => {
  it('offers the four filters of the Stand, each with its count', async () => {
    const onFilters = renderList()
    const pills = within(screen.getByTestId('base-knowledge-attention')).getAllByRole('button')
    expect(pills.map((pill) => pill.textContent)).toEqual(['Alle12', 'Zu bestätigen2', 'Neuere Ausgabe1', 'Prüfung fällig2'])
    await userEvent.click(pills[2])
    expect(onFilters).toHaveBeenCalledWith({ attention: 'newer_edition' })
  })

  it('shows the Stand from the platform’s editions, or from the last check', () => {
    renderList()
    expect(standOfRow('ÖNORM B 8115-2:2021')).toBe('Neuere Ausgabe')
    expect(standOfRow('ÖNORM B 3806:2023')).toBe('Aktuell')
    expect(standOfRow('ÖNORM B 1600:2017')).toBe('Geprüft am 02.10.2026')
    expect(standOfRow('Weisung Dachgeschoßausbau')).toBe('Prüfung fällig')
    expect(standOfRow('ÖNORM B 1300:2018')).toBe('Zu bestätigen')
    expect(standOfRow('ÖNORM B 3806:2005')).toBe('Abgelöst')
    expect(screen.queryByText('Zuletzt geprüft')).toBeNull()
  })

  it('lays the table out fixed, so a filter that leaves one norm does not move the columns', () => {
    renderList()
    expect(screen.getByTestId('base-knowledge-table').className).toContain('table-fixed')
  })

  it('on a phone gives the name the row and says the Stand under it, not in a column that cut the name', () => {
    layout.phone = true
    try {
      renderList()
      expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).not.toContain('Stand')
      const row = screen.getAllByTestId('base-knowledge-row').find((candidate) => within(candidate).queryByText('ÖNORM B 1600:2017'))!
      const nameCell = within(row).getByTestId('base-knowledge-entry-name').closest('td')!
      expect(within(nameCell).getByTestId('base-knowledge-status').textContent).toBe('Geprüft am 02.10.2026')
    } finally {
      layout.phone = false
    }
  })
})
