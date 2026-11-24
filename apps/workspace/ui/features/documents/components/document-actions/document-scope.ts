import type { Namespace } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'

export type DocumentScope = 'files' | 'officeShelf' | 'personal'

export function scopeHasBin(scope: DocumentScope): boolean {
  return scope !== 'personal'
}

export const DOCUMENT_SCOPE_COPY: Record<DocumentScope, Namespace> = { files: filesCopy, officeShelf: officeShelfCopy, personal: filesCopy }
