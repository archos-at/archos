import { MAIL_ARCHIVE_EXTENSIONS } from '@/lib/mail-import/config'

export const MAIL_ARCHIVE_MIME_TYPES: readonly string[] = ['application/vnd.ms-outlook']

export const isMailArchive = (file: { name: string }): boolean => {
  const lower = file.name.toLowerCase()
  return MAIL_ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export const withMailArchivesAccepted = (accept: string): string => {
  const listed = new Set(accept.split(',').map((extension) => extension.trim().toLowerCase()))
  const missing = MAIL_ARCHIVE_EXTENSIONS.filter((extension) => !listed.has(extension))
  return missing.length === 0 ? accept : [accept, ...missing].filter(Boolean).join(',')
}

export function splitMailArchives(files: readonly File[]): { archives: File[]; rest: File[] } {
  const archives: File[] = []
  const rest: File[] = []
  for (const file of files) (isMailArchive(file) ? archives : rest).push(file)
  return { archives, rest }
}
