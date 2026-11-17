import type { Translator } from '@/i18n/translate'
import type {
  BatchValidationError,
  BatchValidationResult,
  FileValidationError,
} from '../validation'

function describeFileError(error: FileValidationError, t: Translator): string {
  switch (error.code) {
    case 'DUPLICATE_FILE':
      return t(
        error.reason === 'duplicate-in-batch'
          ? 'errors.validation.duplicateInBatch'
          : 'errors.validation.duplicateExisting',
        error.params
      )
    case 'INVALID_TYPE':
      return t('errors.validation.invalidType', error.params)
    case 'FILE_TOO_LARGE':
      return t('errors.validation.fileTooLarge', error.params)
  }
}

function describeBatchError(error: BatchValidationError, t: Translator): string {
  const crowded = error.params.crowded === 'yes'
  switch (error.code) {
    case 'TOTAL_SIZE_EXCEEDED':
      return t(
        crowded ? 'errors.validation.totalSizeExceeded' : 'errors.validation.totalSizeExceededFirst',
        error.params
      )
    case 'MAX_FILES_EXCEEDED':
      return t(
        crowded ? 'errors.validation.maxFilesExceeded' : 'errors.validation.maxFilesExceededFirst',
        error.params
      )
  }
}

export function summarizeValidation(result: BatchValidationResult, t: Translator): string | null {
  const parts: string[] = []

  if (result.fileErrors.length === 1) {
    parts.push(describeFileError(result.fileErrors[0], t))
  } else if (result.fileErrors.length > 1) {
    parts.push(t('errors.validation.several', { count: String(result.fileErrors.length) }))
  }

  parts.push(...result.batchErrors.map((error) => describeBatchError(error, t)))

  return parts.length > 0 ? parts.join(' ') : null
}
