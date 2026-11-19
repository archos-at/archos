'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { onNormsSettled, recognizeNorms, type NormRecognition, type SettleProposalsResult } from '@/adapters/api/base-knowledge-client'
import { countsOfResults, normDialogSettled, normDialogShown, type NormDialogSource } from '@/components/norms/norm-dialog-telemetry'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { OFFICE_SHELF_FILES_HREF } from '@/features/documents'
import { MAX_RECOGNIZE_DOCUMENTS, type PlainUpload } from '@/lib/base-knowledge/wire'

type Translate = ReturnType<typeof useTranslations>

export function placeOf(t: Translate, plain: Pick<PlainUpload, 'folderPath'>): string {
  return plain.folderPath ? t('norms.placeFolder', { path: plain.folderPath.split('/').join(' › ') }) : t('norms.placeRoot')
}

export function onePlace(plain: readonly PlainUpload[]): PlainUpload | null {
  const first = plain[0]
  return first && plain.every((file) => file.folderPath === first.folderPath) ? first : null
}

export interface NormRecognitionState {
  recognition: NormRecognition | null
  recognize: (documentIds: readonly string[], options: { source: NormDialogSource; asNorm?: boolean; announcePlain?: boolean }) => Promise<void>
  later: () => void
  settled: () => void
}

interface Shown {
  recognition: NormRecognition
  source: NormDialogSource
}

export function plainHref(plain: readonly PlainUpload[]): string {
  const folderId = onePlace(plain)?.folderId
  return folderId ? `${OFFICE_SHELF_FILES_HREF}?folder=${encodeURIComponent(folderId)}` : OFFICE_SHELF_FILES_HREF
}

export function plainNotice(t: Translate, plain: readonly PlainUpload[]): string {
  const place = onePlace(plain)
  if (plain.length === 1 && place) return t(place.platformHeld ? 'norms.knownOne' : 'norms.noNormsOne', { place: placeOf(t, place) })
  const none = t('norms.noNorms', { count: plain.length })
  return plain.some((file) => file.platformHeld) ? `${none} ${t('norms.platformHeld')}` : none
}

export function knownNotice(t: Translate, plain: readonly PlainUpload[]): string | null {
  const known = plain.filter((file) => file.platformHeld)
  if (known.length === 0) return null
  return known.length === 1 ? t('norms.knownOne', { place: placeOf(t, known[0]) }) : t('norms.known', { count: known.length })
}

export function useNormRecognition(): NormRecognitionState {
  const t = useTranslations(baseKnowledgeCopy)
  const router = useRouter()
  const [shown, setShown] = useState<Shown | null>(null)
  const results = useRef<SettleProposalsResult['results']>([])
  useEffect(() => {
    if (!shown) return
    results.current = []
    const entries = new Set(shown.recognition.proposals.map((proposal) => proposal.entryId))
    return onNormsSettled((result) => {
      results.current = result.results.filter((row) => entries.has(row.entryId))
    })
  }, [shown])
  const recognize = useCallback<NormRecognitionState['recognize']>(
    async (documentIds, { source, asNorm = false, announcePlain = false }) => {
      const unique = [...new Set(documentIds)]
      const ids = unique.slice(0, MAX_RECOGNIZE_DOCUMENTS)
      if (ids.length === 0) return
      try {
        const answer = await recognizeNorms(asNorm ? { documentIds: ids, asNorm } : { documentIds: ids })
        if (answer.proposals.length > 0) {
          normDialogShown(source, answer.proposals.length)
          setShown({ recognition: answer, source })
          return
        }
        if (answer.plain.length === 0) return
        if (announcePlain && unique.length === ids.length) {
          toast(plainNotice(t, answer.plain), {
            action: { label: t('norms.showInFolders'), onClick: () => router.push(plainHref(answer.plain)) },
          })
          return
        }
        const known = knownNotice(t, answer.plain)
        if (known) toast(known)
      } catch {
        toast.error(t('norms.recognizeFailed'))
      }
    },
    [t, router],
  )
  const later = useCallback(() => {
    if (shown) normDialogSettled(shown.source, { later: shown.recognition.proposals.length })
    setShown(null)
  }, [shown])
  const settled = useCallback(() => {
    if (shown) normDialogSettled(shown.source, countsOfResults(results.current))
    setShown(null)
  }, [shown])
  return { recognition: shown?.recognition ?? null, recognize, later, settled }
}
