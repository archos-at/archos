import { DEFAULT_ACCEPTED_TYPES } from '@/shared/config/file-upload'

export const DEFAULT_MAX_FILE_SIZE = 100 * 1e6

export const DEFAULT_MAX_TOTAL_SIZE = 100 * 1e6

export const DEFAULT_MAX_FILE_COUNT = 10

export const DEFAULT_ACCEPTED_FILE_TYPES = DEFAULT_ACCEPTED_TYPES

export const DEFAULT_ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
]

export const MAX_FILE_SIZE = DEFAULT_MAX_FILE_SIZE
export const MAX_TOTAL_SIZE = DEFAULT_MAX_TOTAL_SIZE
export const MAX_FILE_COUNT = DEFAULT_MAX_FILE_COUNT
export const ACCEPTED_FILE_TYPES = DEFAULT_ACCEPTED_FILE_TYPES
export const ACCEPTED_MIME_TYPES = new Set(DEFAULT_ACCEPTED_MIME_TYPES)
