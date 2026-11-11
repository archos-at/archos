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
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'

interface ShelfPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Documents already recorded, left out of the list. */
  recorded: ReadonlySet<string>
  onProposed: () => void
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

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listShelfCandidates()
      .then((list) => !cancelled && setCandidates(list))
      .catch(() => !cancelled && setCandidates([]))
    return () => {
      cancelled = true
    }
  }, [open])

  const shown = useMemo(() => {
    const wanted = search.trim().toLocaleLowerCase()
    return (candidates ?? [])
      .filter(
        (candidate) =>
          !recorded.has(candidate.id) && candidate.name.toLocaleLowerCase().includes(wanted)
      )
      .slice(0, 50)
  }, [candidates, recorded, search])

  const take = async (candidate: ShelfCandidate) => {
    setBusy(candidate.id)
    try {
      await proposeBaseKnowledge(candidate.id)
      toast.success(t('shelfPicker.done'))
      onProposed()
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
        {candidates === null ? (
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
                  variant="outline"
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
