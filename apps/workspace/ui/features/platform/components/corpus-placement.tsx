'use client'

/**
 * Where each base-corpus file belongs (ADR-0165, "Texts are attached in the
 * request"): the corpus table groups its files by the country of the record
 * that names each as its text, and says under each file which edition and
 * change request that is. A file no record names is in its own group, which
 * says so. Read from `GET /api/platform/knowledge/texts`;
 * until that answers the table is as it was, ungrouped.
 */

import type { JSX, MouseEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { TextPlacementList, TextPlacementView } from '@/lib/base-knowledge/platform/text-wire'
import { countryName } from './country-name'
import { lawMapHref } from './law-map/request-link'

const TEXTS = '/api/platform/knowledge/texts'
/** The pages one load follows: 20 × 500 files, far above a corpus of tens of files per country. */
const MAX_PAGES = 20
/** The group of the files no record names; it comes after every country. */
export const UNPLACED = '~'

export interface CorpusPlacement {
  /** Whether the placements were read; false keeps the table ungrouped. */
  loaded: boolean
  of: (fileName: string) => TextPlacementView | undefined
  /** The file's group: its country, {@link UNPLACED}, or '' while nothing is loaded. */
  groupOf: (fileName: string) => string
  /** Table order by group: the countries by code, then the files no record names. */
  compare: (left: string, right: string) => number
}

async function readPlacements(): Promise<TextPlacementView[] | null> {
  const texts: TextPlacementView[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = cursor ? `?limit=500&cursor=${encodeURIComponent(cursor)}` : '?limit=500'
    const response = await fetch(`${TEXTS}${query}`).catch(() => null)
    if (!response?.ok) return null
    const body = (await response.json().catch(() => null)) as Partial<TextPlacementList> | null
    if (!Array.isArray(body?.texts)) return null
    texts.push(...body.texts)
    cursor = body.nextCursor ?? null
    if (!cursor) break
  }
  return texts
}

/** The placements of the corpus's files, read once when the table mounts. */
export function useCorpusPlacement(): CorpusPlacement {
  const [texts, setTexts] = useState<TextPlacementView[] | null>(null)
  useEffect(() => {
    let current = true
    void readPlacements().then((read) => (current ? setTexts(read) : undefined))
    return () => {
      current = false
    }
  }, [])
  return useMemo(() => {
    const byFile = new Map((texts ?? []).map((text) => [text.corpusFile, text]))
    const groupOf = (fileName: string) => (texts === null ? '' : (byFile.get(fileName)?.countryId ?? UNPLACED))
    const order = (fileName: string) => (groupOf(fileName) === UNPLACED ? 'ZZZ' : groupOf(fileName))
    return {
      loaded: texts !== null,
      of: (fileName) => byFile.get(fileName),
      groupOf,
      compare: (left, right) => (order(left) < order(right) ? -1 : order(left) > order(right) ? 1 : 0),
    }
  }, [texts])
}

/** The row that opens a group: the country's name, or that no record names the files below. */
export function CorpusGroupRow({ group, colSpan }: { group: string; colSpan: number }): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50" data-testid="corpus-group">
      <TableCell colSpan={colSpan} className="py-2">
        <span className="text-foreground text-xs font-medium">
          {group === UNPLACED ? t('knowledgeAdmin.placement.unplaced') : countryName(group, locale)}
        </span>
        {group === UNPLACED ? <span className="text-muted-foreground ml-2 text-xs">{t('knowledgeAdmin.placement.unplacedHint')}</span> : null}
      </TableCell>
    </TableRow>
  )
}

/** Under a file's name: the work and edition it is the text of, its change request, and whether offices read it yet. */
export function PlacementLine({ placement }: { placement: TextPlacementView | undefined }): JSX.Element | null {
  const t = useTranslations(platformCopy)
  if (!placement) return null
  const edition = [placement.workTitle, placement.editionLabel].filter(Boolean).join(' · ')
  // The row opens the file's details; the link opens the request instead.
  const keep = (event: MouseEvent) => event.stopPropagation()
  return (
    <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="corpus-placement">
      {edition ? <span className="truncate">{edition}</span> : null}
      {placement.changeRequestId ? (
        <Link
          href={lawMapHref(placement.countryId, placement.changeRequestId)}
          className="text-foreground underline underline-offset-2"
          onClick={keep}
        >
          {t('knowledgeAdmin.placement.request', { title: placement.changeRequestTitle ?? placement.changeRequestId })}
        </Link>
      ) : null}
      <Badge variant={placement.released ? 'success' : 'outline'}>
        {t(placement.released ? 'knowledgeAdmin.placement.released' : 'knowledgeAdmin.placement.pending')}
      </Badge>
    </span>
  )
}
