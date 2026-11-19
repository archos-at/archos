'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { isImageInMail } from '@/lib/inbound-mail/review-defaults'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import type { DraftCopy, UnnamedPart } from '../lib/draft'

/** A type a reader knows by its short name (PDF, PNG, ZIP); `octet-stream` or `vnd.ms-excel…` says nothing. */
const SHORT_SUBTYPE = /^[a-z0-9]{2,5}$/i

function unnamedPartName(part: UnnamedPart, t: Translator, locale: string): string {
  if (isImageInMail(part)) return t('attachments.imageInText')
  const size = formatBytes(part.sizeBytes, locale)
  const subtype = part.contentType.split('/')[1]?.split(';')[0]?.trim() ?? ''
  return SHORT_SUBTYPE.test(subtype) ? t('attachments.unnamed', { type: subtype.toUpperCase(), size }) : t('attachments.unnamedSized', { size })
}

export function useDraftCopy(): DraftCopy {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  return useMemo(() => ({ unnamedAttachment: (part) => unnamedPartName(part, t, locale), untitledThread: t('row.noSubject') }), [t, locale])
}
