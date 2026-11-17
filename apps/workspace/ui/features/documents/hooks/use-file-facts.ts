'use client'

import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatBytes } from '@/lib/format'
import { fileFormatMessage } from '../document-kind'
import type { FileItem } from '../file-types'

export function useFileFacts(file: FileItem): string {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const format = fileFormatMessage(file)
  const paged = format?.key !== 'image' && format?.key !== 'ifc'
  const facts: string[] = []
  if (format) facts.push(t(`preview.formats.${format.key}`, format.values))
  if (paged && file.pageCount && file.pageCount > 0) {
    facts.push(t('preview.pageCount', { count: file.pageCount }))
  }
  if (file.fileSize && file.fileSize > 0) facts.push(formatBytes(file.fileSize, locale))
  return facts.join(' · ')
}
