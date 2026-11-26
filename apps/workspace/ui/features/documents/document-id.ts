import { isUuid } from '@/lib/ids'

export const isDocumentId = (value: string | null | undefined): value is string => typeof value === 'string' && isUuid(value)
