'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { recognizeNorms, type NormRecognition } from '@/adapters/api/base-knowledge-client'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
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

export function useNormRecognition({ showPlain }: { showPlain?: (plain: readonly PlainUpload[]) => void } = {}): NormRecognitionState {
  const t = useTranslations(baseKnowledgeCopy)
  const [recognition, setRecognition] = useState<NormRecognition | null>(null)
  const recognize = useCallback<NormRecognitionState['recognize']>(
    async (documentIds, { asNorm = false, announcePlain = false } = {}) => {
      const ids = [...new Set(documentIds)].slice(0, MAX_RECOGNIZE_DOCUMENTS)
      if (ids.length === 0) return
      try {
        const answer = await recognizeNorms(asNorm ? { documentIds: ids, asNorm } : { documentIds: ids })
        if (answer.proposals.length > 0) {
          setRecognition(answer)
          return
        }
        if (!announcePlain || answer.plain.length === 0) return
        const place = onePlace(answer.plain)
        toast(
          answer.plain.length === 1 && place
            ? t('norms.noNormsOne', { place: placeOf(t, place) })
            : t('norms.noNorms', { count: answer.plain.length }),
          showPlain ? { action: { label: t('norms.showInFolders'), onClick: () => showPlain(answer.plain) } } : undefined,
        )
      } catch {
        toast.error(t('norms.recognizeFailed'))
      }
    },
    [t, showPlain],
  )
  const close = useCallback(() => setRecognition(null), [])
  return { recognition, recognize, close }
}
