'use client'

import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FileAssignee } from '../file-types'
import type { DocumentReview } from './use-document-review'

export function useSelfAssignee(review: DocumentReview): FileAssignee | null {
  const t = useTranslations(filesCopy)
  if (!review.me) return null
  const name = review.room.self?.userId === review.me ? review.room.self.name : null
  return { userId: review.me, name: name || t('review.assigneeYou'), email: null, profilePictureUrl: null }
}
