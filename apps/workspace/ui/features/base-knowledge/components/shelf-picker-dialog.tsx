'use client'

/**
 * Take a document already in the Büroablage as an office standard: search the
 * shelf, pick one, and it is proposed here while it stays where it is filed.
 * The shelf's newest 200 documents; a document already recorded is refused by
 * the server with its reason.
 */

import { useEffect, useMemo, useState, type JSX } from 'react'
import { toast } from 'sonner'
import {
  listShelfCandidates,
  proposeBaseKnowledge,
  type BaseKnowledgeEntry,
  type ShelfCandidate,
} from '@/adapters/api/base-knowledge-client'
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
  /** Documents already recorded, left out of the list. */
  recorded: ReadonlySet<string>
  /** The proposal just made, to open as its form. */
  onProposed: (entry: BaseKnowledgeEntry) => void
}

export function ShelfPickerDialog({
  open,
  onOpenChange,
  recorded,
  onProposed,
}: ShelfPickerDialogProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const [candidates, setCandidates] = useState<ShelfCandidate[] | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // The shelf searches itself by name, so an older file is found as surely as one of the newest.
  const query = useDebouncedValue(search, 250)
  // A load that failed is said as such, with a retry, and never shown as an empty shelf.
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
      onProposed(await proposeBaseKnowledge(candidate.id))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('saveError'))
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
