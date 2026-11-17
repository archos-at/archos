'use client'

import type { JSX } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'

import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { SearchExportFormat } from '../lib/search-client'

export function SearchExportMenu({
  onExport,
  busy,
}: {
  onExport: (format: SearchExportFormat) => void
  busy: boolean
}): JSX.Element {
  const t = useTranslations(searchCopy, 'export')
  return (
    <ActionMenu
      mode="dropdown"
      entries={[
        { type: 'item', id: 'csv', label: t('csv'), icon: FileText, onSelect: () => onExport('csv'), testId: 'search-export-csv' },
        { type: 'item', id: 'xlsx', label: t('xlsx'), icon: FileSpreadsheet, onSelect: () => onExport('xlsx'), testId: 'search-export-xlsx' },
        { type: 'separator' },
        { type: 'label', label: t('allColumns') },
      ]}
      trigger={
        <Button type="button" variant="ghost" size="icon" aria-label={t('label')} title={t('label')} aria-busy={busy || undefined} disabled={busy} data-testid="search-export">
          <Download aria-hidden />
        </Button>
      }
    />
  )
}
