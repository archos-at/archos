import type { FileUploadConfig } from '@/shared/context'
import { IMAGE_EXTENSIONS, buildAcceptedMimeTypes } from '@/shared/config/file-upload'

export type PhotoUnavailableReason = 'vlm-unavailable' | 'not-enabled'

export type PhotoIntake =
  | {
      available: true
      accept: string
    }
  | { available: false; reason: PhotoUnavailableReason }

const isImageExtension = (extension: string): boolean =>
  (IMAGE_EXTENSIONS as readonly string[]).includes(extension.trim().toLowerCase())

export function photoIntake(
  config: Pick<FileUploadConfig, 'acceptedTypes' | 'imageUploadBlockedReason'>
): PhotoIntake {
  const images = config.acceptedTypes.split(',').filter(isImageExtension).join(',')
  if (images) return { available: true, accept: buildAcceptedMimeTypes(images).join(',') }
  return {
    available: false,
    reason:
      config.imageUploadBlockedReason === 'vlm-unavailable' ? 'vlm-unavailable' : 'not-enabled',
  }
}

export function documentsOnlyAccept(acceptedTypes: string): string {
  return acceptedTypes
    .split(',')
    .map((extension) => extension.trim())
    .filter((extension) => extension && !isImageExtension(extension))
    .join(',')
}

const HEIC_NAME = /\.(heic|heif)$/i
const HEIC_TYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

export function isHeic(file: Pick<File, 'name' | 'type'>): boolean {
  return HEIC_NAME.test(file.name) || HEIC_TYPES.has(file.type.toLowerCase())
}

const PHOTO_NAME = /\.(jpe?g|png|webp|heic|heif)$/i

const GENERIC_PHOTO_NAME =
  /^(image|photo|picture|foto|bild)(?:[\s_-]*\(?\d{0,3}\)?)?\.(jpe?g|png|webp|heic|heif)$/i

export function isGenericPhotoName(name: string): boolean {
  return GENERIC_PHOTO_NAME.test(name.trim())
}

const pad = (value: number): string => String(value).padStart(2, '0')

export function photoBaseName(takenAt: Date, prefix: string): string {
  const date = `${takenAt.getFullYear()}-${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())}`
  const time = `${pad(takenAt.getHours())}-${pad(takenAt.getMinutes())}-${pad(takenAt.getSeconds())}`
  return `${prefix} ${date} ${time}`
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function uniqueName(base: string, extension: string, taken: Set<string>): string {
  let candidate = `${base}${extension}`
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1)
    candidate = `${base} (${n})${extension}`
  taken.add(candidate.toLowerCase())
  return candidate
}

const MAX_REENCODED_EDGE_PX = 4096

export async function heicToJpeg(file: File, name: string): Promise<File | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_REENCODED_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return null
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return null
  }
}

export interface PreparePhotosOptions {
  source: 'camera' | 'picker'
  prefix: string
  taken?: Iterable<string>
  imagesAccepted: boolean
  now?: () => Date
  convertHeic?: (file: File, name: string) => Promise<File | null>
}

export interface PreparedPhotos {
  files: File[]
  unconvertibleHeic: string[]
}

export async function prepareSitePhotos(
  files: File[],
  options: PreparePhotosOptions
): Promise<PreparedPhotos> {
  const {
    source,
    prefix,
    imagesAccepted,
    now = () => new Date(),
    convertHeic = heicToJpeg,
  } = options
  const taken = new Set(Array.from(options.taken ?? [], (name) => name.toLowerCase()))
  const prepared: File[] = []
  const unconvertibleHeic: string[] = []
  const keep = (file: File): void => {
    taken.add(file.name.toLowerCase())
    prepared.push(file)
  }

  for (const file of files) {
    const photo = PHOTO_NAME.test(file.name) || file.type.startsWith('image/')
    const heic = photo && isHeic(file)
    const nameless = source === 'camera' || isGenericPhotoName(file.name)
    if (!photo || (!heic && !nameless) || (heic && !imagesAccepted)) {
      keep(file)
      continue
    }
    const ownExtension = extensionOf(file.name)
    const takenAt = file.lastModified > 0 ? new Date(file.lastModified) : now()
    const base = nameless
      ? photoBaseName(takenAt, prefix)
      : file.name.slice(0, file.name.length - ownExtension.length)
    const name = uniqueName(base, heic ? '.jpg' : ownExtension || '.jpg', taken)
    if (!heic) {
      prepared.push(new File([file], name, { type: file.type, lastModified: file.lastModified }))
      continue
    }
    const converted = await convertHeic(file, name)
    if (converted) prepared.push(converted)
    else unconvertibleHeic.push(file.name)
  }

  return { files: prepared, unconvertibleHeic }
}
