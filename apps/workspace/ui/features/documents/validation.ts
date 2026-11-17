import type { FileUploadConfig } from '@/shared/context'
import { IMAGE_EXTENSIONS } from '@/shared/config/file-upload'
import { isIfcFilename } from '@/lib/bim/types'
import { ZIP_MIME_TYPES } from './lib/zip-types'
import {
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_TOTAL_SIZE,
  DEFAULT_MAX_FILE_COUNT,
  DEFAULT_ACCEPTED_FILE_TYPES,
  DEFAULT_ACCEPTED_MIME_TYPES,
} from './constants'
import { formatBytes } from '@/lib/format'

export type FileValidationErrorCode = 'FILE_TOO_LARGE' | 'INVALID_TYPE' | 'DUPLICATE_FILE'

export type BatchValidationErrorCode = 'TOTAL_SIZE_EXCEEDED' | 'MAX_FILES_EXCEEDED'

export type FileValidationReason = 'image-vlm-unavailable' | 'duplicate-in-batch' | 'duplicate-existing'

export type ValidationMessageParams = Record<string, string>

export interface FileValidationError {
  file: File
  code: FileValidationErrorCode
  message: string
  reason?: FileValidationReason
  params: ValidationMessageParams
}

export interface BatchValidationError {
  code: BatchValidationErrorCode
  message: string
  params: ValidationMessageParams
}

export interface BatchValidationResult {
  valid: boolean
  canUpload: boolean
  validFiles: File[]
  fileErrors: FileValidationError[]
  batchErrors: BatchValidationError[]
  summary: string | null
}

export interface ValidationContext {
  existingTotalSize: number
  existingFileCount: number
  existingFileNames: Set<string>
  durableCorpus?: boolean
}

const DEFAULT_CONFIG: FileUploadConfig = {
  acceptedTypes: DEFAULT_ACCEPTED_FILE_TYPES,
  acceptedMimeTypes: DEFAULT_ACCEPTED_MIME_TYPES,
  maxTotalSizeMB: 100,
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  maxIfcFileSize: 0,
  maxTotalSize: DEFAULT_MAX_TOTAL_SIZE,
  maxFileCount: DEFAULT_MAX_FILE_COUNT,
  fileExpirationCheckIntervalHours: 0,
}

function isImageFileName(fileName: string): boolean {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return false
  const ext = fileName.slice(idx).toLowerCase()
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

export function isValidFileExtension(
  fileName: string,
  config: FileUploadConfig = DEFAULT_CONFIG
): boolean {
  const parts = fileName.split('.')
  if (parts.length < 2) return false
  const acceptedExtensions = config.acceptedTypes.split(',').map((ext) => ext.toLowerCase().trim())
  const extension = '.' + parts.pop()?.toLowerCase()
  return acceptedExtensions.includes(extension)
}

export function isValidMimeType(
  mimeType: string,
  config: FileUploadConfig = DEFAULT_CONFIG
): boolean {
  if (!mimeType) return true
  const normalized = mimeType.toLowerCase()
  return config.acceptedMimeTypes.some((m) => m.toLowerCase() === normalized)
}

export function createEmptyValidationContext(): ValidationContext {
  return {
    existingTotalSize: 0,
    existingFileCount: 0,
    existingFileNames: new Set(),
  }
}

export function validateFileUpload(
  files: File[],
  context: ValidationContext = createEmptyValidationContext(),
  config: FileUploadConfig = DEFAULT_CONFIG,
  locale?: string
): BatchValidationResult {
  const fileErrors: FileValidationError[] = []
  const batchErrors: BatchValidationError[] = []
  const potentiallyValidFiles: File[] = []

  let newFilesTotalSize = 0
  const newFileNames = new Set<string>()

  for (const file of files) {
    if (newFileNames.has(file.name)) {
      fileErrors.push({
        file,
        code: 'DUPLICATE_FILE',
        reason: 'duplicate-in-batch',
        message: `"${file.name}" is included multiple times`,
        params: { name: file.name },
      })
      continue
    }

    if (!context.durableCorpus && context.existingFileNames.has(file.name)) {
      fileErrors.push({
        file,
        code: 'DUPLICATE_FILE',
        reason: 'duplicate-existing',
        message: `"${file.name}" already exists in this session`,
        params: { name: file.name },
      })
      continue
    }

    if (!isValidFileExtension(file.name, config)) {
      const isImageBlockedByVlm =
        config.imageUploadBlockedReason === 'vlm-unavailable' && isImageFileName(file.name)
      fileErrors.push({
        file,
        code: 'INVALID_TYPE',
        message: isImageBlockedByVlm
          ? `"${file.name}" needs a configured vision model (VLM) to upload.`
          : `"${file.name}" is not a supported file type. Accepted: ${config.acceptedTypes}`,
        ...(isImageBlockedByVlm ? { reason: 'image-vlm-unavailable' as const } : {}),
        params: { name: file.name, accepted: config.acceptedTypes },
      })
      continue
    }

    const sizeCeiling =
      isIfcFilename(file.name) && config.maxIfcFileSize > 0
        ? config.maxIfcFileSize
        : config.maxFileSize
    if (file.size > sizeCeiling) {
      fileErrors.push({
        file,
        code: 'FILE_TOO_LARGE',
        message: `"${file.name}" is ${formatBytes(file.size, locale)}, exceeds ${formatBytes(sizeCeiling, locale)} limit`,
        params: {
          name: file.name,
          size: formatBytes(file.size, locale),
          limit: formatBytes(sizeCeiling, locale),
        },
      })
      continue
    }

    potentiallyValidFiles.push(file)
    newFilesTotalSize += file.size
    newFileNames.add(file.name)
  }

  const totalSize = context.existingTotalSize + newFilesTotalSize
  const totalCount = context.existingFileCount + potentiallyValidFiles.length

  const carriesIfc =
    potentiallyValidFiles.some((file) => isIfcFilename(file.name)) ||
    [...context.existingFileNames].some((name) => isIfcFilename(name))
  const totalCeiling =
    carriesIfc && config.maxIfcFileSize > config.maxTotalSize
      ? config.maxIfcFileSize
      : config.maxTotalSize

  if (!context.durableCorpus && totalSize > totalCeiling) {
    const availableSpace = Math.max(0, totalCeiling - context.existingTotalSize)
    batchErrors.push({
      code: 'TOTAL_SIZE_EXCEEDED',
      message:
        context.existingTotalSize > 0
          ? `Total size would be ${formatBytes(totalSize, locale)}. Only ${formatBytes(availableSpace, locale)} available (${formatBytes(totalCeiling, locale)} limit).`
          : `Total size ${formatBytes(totalSize, locale)} exceeds ${formatBytes(totalCeiling, locale)} limit.`,
      params: {
        total: formatBytes(totalSize, locale),
        available: formatBytes(availableSpace, locale),
        limit: formatBytes(totalCeiling, locale),
        crowded: context.existingTotalSize > 0 ? 'yes' : 'no',
      },
    })
  }

  if (!context.durableCorpus && totalCount > config.maxFileCount) {
    const availableSlots = Math.max(0, config.maxFileCount - context.existingFileCount)
    batchErrors.push({
      code: 'MAX_FILES_EXCEEDED',
      message:
        context.existingFileCount > 0
          ? `Would have ${totalCount} files. Only ${availableSlots} more allowed (${config.maxFileCount} max).`
          : `${totalCount} files exceeds the ${config.maxFileCount} file limit.`,
      params: {
        total: String(totalCount),
        available: String(availableSlots),
        limit: String(config.maxFileCount),
        crowded: context.existingFileCount > 0 ? 'yes' : 'no',
      },
    })
  }

  const hasBatchErrors = batchErrors.length > 0
  const hasFileErrors = fileErrors.length > 0
  const isValid = !hasBatchErrors && !hasFileErrors && potentiallyValidFiles.length > 0
  const canUpload = !hasBatchErrors && potentiallyValidFiles.length > 0

  let summary: string | null = null
  if (hasFileErrors || hasBatchErrors) {
    const parts: string[] = []

    if (hasFileErrors) {
      const fileErrorSummary =
        fileErrors.length === 1 ? fileErrors[0].message : `${fileErrors.length} files have issues`
      parts.push(fileErrorSummary)
    }

    if (hasBatchErrors) {
      parts.push(...batchErrors.map((e) => e.message))
    }

    summary = parts.join(' ')
  }

  return {
    valid: isValid,
    canUpload,
    validFiles: hasBatchErrors ? [] : potentiallyValidFiles,
    fileErrors,
    batchErrors,
    summary,
  }
}

export function checkDraggedFilesSupported(
  dataTransfer: DataTransfer,
  config: FileUploadConfig = DEFAULT_CONFIG,
  { allowZip = false }: { allowZip?: boolean } = {}
): boolean {
  const items = Array.from(dataTransfer.items)
  for (const item of items) {
    if (item.kind !== 'file') continue
    if (allowZip && ZIP_MIME_TYPES.includes(item.type.toLowerCase())) continue
    if (!isValidMimeType(item.type, config)) return false
  }
  return true
}
