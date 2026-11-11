'use client'

/**
 * What a confirmation covers, shown before it is given: every record of the
 * unit with each field in words and each source with its quote. A row says its
 * value once; this is where a reviewer reads everything the yes accepts
 * (a licence, a date in force, a region's parents), folded until asked for.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import type { LawMap } from '@/lib/base-knowledge/platform/law-map'
import type { ReviewUnit } from '@/lib/base-knowledge/platform/law-map-review'
import type { CaptureView, RevisionView } from '@/lib/base-knowledge/platform/wire'
import { SourceQuote } from './law-map-atoms'

/** The fields a reviewer reads, in the order they read best; anything else follows under its own path. */
const FIELDS = [
  'name',
  'title',
  'kind',
  'identifiers',
  'label',
  'issuer',
  'competenceTerritoryIds',
  'seatTerritoryId',
  'functionCodes',
  'territoryIds',
  'addressees',
  'parents',
  'issuedOn',
  'inForceFrom',
  'inForceTo',
  'validFrom',
  'validTo',
  'workId',
  'editionId',
  'form',
  'language',
  'licenceClass',
  'corpusFile',
  'aliases',
] as const

const rank = (path: string): number => {
  const at = (FIELDS as readonly string[]).indexOf(path)
  return at < 0 ? FIELDS.length : at
}

/** A value in words: a region by its name, a list as a list, anything structured as compact JSON. */
export function valueText(value: unknown, map: LawMap): string {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'string') {
    const territory = map.territories.get(value)
    return territory ? `${territory.name} (${value})` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((one) => typeof one === 'string')) return value.map((one) => valueText(one, map)).join(', ')
  return JSON.stringify(value)
}

function Record({ revision, map, captures }: { revision: RevisionView; map: LawMap; captures: ReadonlyMap<string, CaptureView> }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const claims = [...revision.claims].sort((a, b) => rank(a.path) - rank(b.path))
  return (
    <li className="flex flex-col gap-2" data-testid={`entry-${revision.recordId}`}>
      <p className="text-muted-foreground text-xs">{t(`recordType.${revision.type}`)}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        {claims.map((claim) => (
          <div key={claim.path} className="contents">
            <dt className="text-muted-foreground">{rank(claim.path) < FIELDS.length ? t(`fields.${claim.path}`) : claim.path}</dt>
            <dd className="break-words">
              {valueText(claim.value, map)}
              {claim.decision === 'rejected' || claim.decision === 'edited' ? <span className="text-destructive"> · {t('claimRejected')}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {revision.citations.length === 0 ? (
        <p className="text-warning text-xs">{t('noSource')}</p>
      ) : (
        revision.citations.map((citation, index) => {
          const capture = citation.captureId ? captures.get(citation.captureId) : undefined
          const url = citation.url ?? capture?.url ?? null
          const note = [citation.note ?? null, capture && !capture.countsAsFetched ? t('pasted') : null].filter(Boolean).join(' · ') || null
          return url ? <SourceQuote key={index} url={url} quote={citation.quote ?? null} note={note} /> : null
        })
      )}
    </li>
  )
}

export function Entries({ unit, map, captures }: { unit: ReviewUnit; map: LawMap; captures: ReadonlyMap<string, CaptureView> }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-2" aria-expanded={shown} onClick={() => setShown((now) => !now)} data-testid={`entries-${unit.key}`}>
        {shown ? t('hideEntries') : t('entries', { count: unit.revisions.length })}
      </button>
      {shown ? (
        <ul className="flex flex-col gap-4 border-l pl-3">
          {unit.revisions.map((revision) => (
            <Record key={revision.revisionId} revision={revision} map={map} captures={captures} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
