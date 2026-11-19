'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { recognizeNorms, type NormRecognition } from '@/adapters/api/base-knowledge-client'
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
  recognize: (documentIds: readonly string[], options?: { asNorm?: boolean; announcePlain?: boolean }) => Promise<void>
  close: () => void
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
  const [recognition, setRecognition] = useState<NormRecognition | null>(null)
  const recognize = useCallback<NormRecognitionState['recognize']>(
    async (documentIds, { asNorm = false, announcePlain = false } = {}) => {
      const unique = [...new Set(documentIds)]
      const ids = unique.slice(0, MAX_RECOGNIZE_DOCUMENTS)
      if (ids.length === 0) return
      try {
        const answer = await recognizeNorms(asNorm ? { documentIds: ids, asNorm } : { documentIds: ids })
        if (answer.proposals.length > 0) {
          setRecognition(answer)
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
  const close = useCallback(() => setRecognition(null), [])
  return { recognition, recognize, close }
}
