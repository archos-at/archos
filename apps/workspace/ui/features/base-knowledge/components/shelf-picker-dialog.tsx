'use client'

import { useEffect, useMemo, useState, type JSX } from 'react'
import { listShelfCandidates, type ShelfCandidate } from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '@/components/ui/load-error'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

interface ShelfPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recorded: ReadonlySet<string>
  onPick: (documentId: string) => Promise<void>
}

export function ShelfPickerDialog({
  open,
  onOpenChange,
  recorded,
  onPick,
}: ShelfPickerDialogProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const [candidates, setCandidates] = useState<ShelfCandidate[] | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const query = useDebouncedValue(search, 250)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setFailed(false)
    listShelfCandidates(query)
      .then((list) => !cancelled && setCandidates(list))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [open, query, attempt])

  const shown = useMemo(
    () => (candidates ?? []).filter((candidate) => !recorded.has(candidate.id)).slice(0, 50),
    [candidates, recorded],
  )

  const take = async (candidate: ShelfCandidate) => {
    setBusy(candidate.id)
    try {
      await onPick(candidate.id)
      onOpenChange(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('shelfPicker.title')}</DialogTitle>
          <DialogDescription>{t('shelfPicker.description')}</DialogDescription>
        </DialogHeader>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t('shelfPicker.search')}
          label={t('shelfPicker.search')}
          clearLabel={t('filter.clear')}
        />
        {failed ? (
          <LoadError title={t('shelfPicker.loadError')} onRetry={() => setAttempt((n) => n + 1)} />
        ) : candidates === null ? (
          <Skeleton className="h-24 w-full" />
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('shelfPicker.none')}</p>
        ) : (
          <ul
            className="max-h-80 divide-y overflow-y-auto"
            data-testid="base-knowledge-shelf-candidates"
          >
            {shown.map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm">{candidate.name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void take(candidate)}
                >
                  {t('shelfPicker.take')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
