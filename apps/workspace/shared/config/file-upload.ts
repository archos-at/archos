import type { FileUploadConfig } from '@/shared/context'
import { IFC_EXTENSIONS, IFC_MIME_TYPES } from '@/lib/bim/types'
import { BYTES_PER_MB, maxDocumentBytesFrom, maxIfcBytesFrom } from './request-body-limit'

export const DEFAULT_ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf'
const DEFAULT_MAX_FILE_COUNT = 10
const DEFAULT_EXPIRATION_CHECK_INTERVAL_HOURS = 0

const EXTENSION_TO_MIME: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.md': ['text/markdown', 'text/x-markdown'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.html': ['text/html'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
  '.json': ['application/json'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.ifc': [...IFC_MIME_TYPES, 'application/octet-stream'],
  '.ifczip': ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  '.dxf': ['application/dxf', 'image/vnd.dxf', 'image/x-dxf', 'application/x-dxf', 'application/octet-stream'],
}

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const

export const IFC_UPLOAD_EXTENSIONS = IFC_EXTENSIONS

const isGatedExtension = (ext: string): boolean => {
  const lower = ext.toLowerCase()
  return (
    IMAGE_EXTENSIONS.includes(lower as (typeof IMAGE_EXTENSIONS)[number]) ||
    IFC_UPLOAD_EXTENSIONS.includes(lower as (typeof IFC_UPLOAD_EXTENSIONS)[number])
  )
}

const stripGatedExtensions = (acceptedTypes: string): string =>
  acceptedTypes
    .split(',')
    .map((ext) => ext.trim())
    .filter((ext) => ext && !isGatedExtension(ext))
    .join(',')

const parsePositiveNumber = (value: string | undefined): number | null => {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

export const mimeTypeForFileName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return ''
  return EXTENSION_TO_MIME[fileName.slice(dot).toLowerCase()]?.[0] ?? ''
}

export const buildAcceptedMimeTypes = (acceptedTypes: string): string[] => {
  const mimeTypes = new Set<string>()
  const extensions = acceptedTypes
    .split(',')
    .map((ext) => ext.toLowerCase().trim())
    .filter(Boolean)

  for (const ext of extensions) {
    const mimes = EXTENSION_TO_MIME[ext]
    if (!mimes) continue
    for (const mime of mimes) {
      mimeTypes.add(mime.toLowerCase())
    }
  }

  return Array.from(mimeTypes)
}

export interface FileUploadConfigOptions {
  imageUploadEnabled?: boolean
  vlmAvailable?: boolean
  ifcUploadEnabled?: boolean
  maxFileSizeBytes?: number
}

export const getFileUploadConfigFromEnv = (
  env: Record<string, string | undefined> = process.env,
  options: FileUploadConfigOptions = {}
): FileUploadConfig => {
  const { imageUploadEnabled = true, vlmAvailable = false, ifcUploadEnabled = true } = options
  const rawAcceptedTypes = env.FILE_UPLOAD_ACCEPTED_TYPES || DEFAULT_ACCEPTED_TYPES

  const imagesAllowed = imageUploadEnabled && vlmAvailable
  const baseTypes = stripGatedExtensions(rawAcceptedTypes)
  const acceptedTypes = [
    baseTypes,
    ...(imagesAllowed ? IMAGE_EXTENSIONS : []),
    ...(ifcUploadEnabled ? IFC_UPLOAD_EXTENSIONS : []),
  ]
    .filter(Boolean)
    .join(',')

  const imageUploadBlockedReason: FileUploadConfig['imageUploadBlockedReason'] =
    imageUploadEnabled && !vlmAvailable ? 'vlm-unavailable' : null

  const maxFileCount =
    parsePositiveNumber(env.FILE_UPLOAD_MAX_FILE_COUNT) ?? DEFAULT_MAX_FILE_COUNT
  const fileExpirationCheckIntervalHours =
    parsePositiveNumber(env.FILE_EXPIRATION_CHECK_INTERVAL_HOURS) ??
    DEFAULT_EXPIRATION_CHECK_INTERVAL_HOURS
  const deploymentMaxBytes = maxDocumentBytesFrom(env)
  const maxSizeBytes = options.maxFileSizeBytes ?? deploymentMaxBytes
  const maxTotalBytes = Math.max(deploymentMaxBytes, maxSizeBytes)

  const maxIfcFileSize = ifcUploadEnabled ? maxIfcBytesFrom(env) : 0

  return {
    acceptedTypes,
    acceptedMimeTypes: buildAcceptedMimeTypes(acceptedTypes),
    maxTotalSizeMB: maxTotalBytes / BYTES_PER_MB,
    maxFileSize: maxSizeBytes,
    maxIfcFileSize,
    maxTotalSize: maxTotalBytes,
    maxFileCount,
    fileExpirationCheckIntervalHours,
    imageUploadBlockedReason,
  }
}

export type UploadTypeGates = Required<
  Pick<FileUploadConfigOptions, 'imageUploadEnabled' | 'vlmAvailable' | 'ifcUploadEnabled'>
>

export const uploadExtensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

export const acceptedUploadExtensions = (
  gates: UploadTypeGates,
  env: Record<string, string | undefined> = process.env
): string[] =>
  getFileUploadConfigFromEnv(env, gates)
    .acceptedTypes.split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
