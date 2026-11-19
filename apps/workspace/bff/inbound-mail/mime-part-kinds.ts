import { INBOUND_MAIL_MAX_MESSAGE_BYTES } from './inbound-mail-vocabulary'
import type { Attachment, Email } from 'postal-mime'
import type { NotStagedReason, PartRiskFlag } from './contract'
import { asBuffer } from './mime-header-block'

export const MAX_PART_BYTES = INBOUND_MAIL_MAX_MESSAGE_BYTES

const PDF_TRAILER_BYTES = 1024 * 1024

const TRACKING_PIXEL_MAX_BYTES = 2 * 1024

const SIGNATURE_IMAGE_MAX_BYTES = 32 * 1024

const AUTO_NAMED_IMAGE = [
  /^image\d{3,}\.(png|jpe?g|gif|bmp)$/i,
  /^Outlook-.*\.(png|jpe?g|gif|bmp)$/i,
  /^~WRL.*\.(png|jpe?g|gif|bmp)$/i,
]

const TNEF_TYPES = new Set(['application/ms-tnef', 'application/vnd.ms-tnef'])
const SIGNATURE_TYPES = new Set([
  'application/pkcs7-signature',
  'application/x-pkcs7-signature',
  'application/pgp-signature',
])
const ENCRYPTED_TYPES = new Set(['application/pkcs7-mime', 'application/x-pkcs7-mime', 'application/pgp-encrypted'])
const CALENDAR_TYPES = new Set(['text/calendar', 'application/ics'])

export const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.gz', '.tgz', '.tar', '.bz2', '.xz', '.zst', '.cab'])

const MACRO_EXTENSIONS = new Set(['.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppsm', '.ppam'])

const OOXML_EXTENSIONS = new Set(['.docx', '.dotx', '.xlsx', '.xltx', '.pptx', '.potx', '.ppsx', ...MACRO_EXTENSIONS])

const EXPECTED_SNIFFS: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['pdf'],
  '.png': ['png'],
  '.jpg': ['jpg'],
  '.jpeg': ['jpg'],
  '.gif': ['gif'],
  '.webp': ['webp'],
  '.tif': ['tif'],
  '.tiff': ['tif'],
  '.heic': ['heic'],
  '.bmp': ['bmp'],
  '.doc': ['cfb'],
  '.xls': ['cfb'],
  '.ppt': ['cfb'],
  '.msg': ['cfb'],
  '.zip': ['zip'],
  '.7z': ['7z'],
  '.rar': ['rar'],
  '.gz': ['gz'],
  '.dwg': ['dwg'],
  '.docx': ['docx', 'zip'],
  '.dotx': ['docx', 'zip'],
  '.docm': ['docm', 'docx', 'zip'],
  '.dotm': ['docm', 'docx', 'zip'],
  '.xlsx': ['xlsx', 'zip'],
  '.xltx': ['xlsx', 'zip'],
  '.xlsm': ['xlsm', 'xlsx', 'zip'],
  '.xltm': ['xlsm', 'xlsx', 'zip'],
  '.xlam': ['xlsm', 'xlsx', 'zip'],
  '.pptx': ['pptx', 'zip'],
  '.potx': ['pptx', 'zip'],
  '.ppsx': ['pptx', 'zip'],
  '.pptm': ['pptm', 'pptx', 'zip'],
  '.potm': ['pptm', 'pptx', 'zip'],
  '.ppsm': ['pptm', 'pptx', 'zip'],
  '.ppam': ['pptm', 'pptx', 'zip'],
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.xml', '.json', '.ifc', '.ics', '.vcf'])

const TEXTUAL_SNIFFS = new Set(['xml', 'svg', 'html', 'ics', 'vcf'])

const EXECUTABLE_SNIFFS = new Set(['exe', 'elf', 'macho', 'msi', 'apk', 'dex', 'class', 'wasm', 'swf', 'deb', 'rpm'])

export interface MessageContext {
  encrypted: boolean
  depth: number
}

export function isEncryptedMessage(email: Email): boolean {
  const contentType = email.headers.find((header) => header.key === 'content-type')?.value ?? ''
  return /^\s*(multipart\/encrypted|application\/(x-)?pkcs7-mime)\b/i.test(contentType)
}

function isSignatureImage(attachment: Attachment, size: number): boolean {
  const shownInTheText = attachment.disposition === 'inline' || attachment.related === true
  return Boolean(attachment.contentId) && shownInTheText && size <= SIGNATURE_IMAGE_MAX_BYTES
}

function isEmbedded(attachment: Attachment, name: string, size: number): boolean {
  if (attachment.related && !name) return true
  if (AUTO_NAMED_IMAGE.some((pattern) => pattern.test(name))) return true
  if (!attachment.mimeType.toLowerCase().startsWith('image/')) return false
  return size < TRACKING_PIXEL_MAX_BYTES || isSignatureImage(attachment, size)
}

export function structuralSkip(attachment: Attachment, name: string, size: number, context: MessageContext): NotStagedReason | null {
  const type = attachment.mimeType.toLowerCase()
  const lower = name.toLowerCase()
  if (context.encrypted || ENCRYPTED_TYPES.has(type) || lower.endsWith('.p7m')) return 'encrypted'
  if (TNEF_TYPES.has(type) || lower === 'winmail.dat') return 'tnef'
  if (SIGNATURE_TYPES.has(type) || lower.endsWith('.p7s')) return 'signature'
  if (CALENDAR_TYPES.has(type) || lower.endsWith('.ics')) return 'calendar'
  if (size === 0) return 'empty'
  if (size > MAX_PART_BYTES) return 'size'
  return isEmbedded(attachment, name, size) ? 'embedded' : null
}

function isEncryptedFile(bytes: Uint8Array, extension: string | null, sniffed: string | null): boolean {
  if (extension && OOXML_EXTENSIONS.has(extension) && sniffed === 'cfb') return true
  if (sniffed === 'zip' || extension === '.zip') {
    return bytes.byteLength > 6 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[6] & 1) === 1
  }
  if (sniffed === 'pdf') {
    const tail = asBuffer(bytes).subarray(Math.max(0, bytes.byteLength - PDF_TRAILER_BYTES))
    return tail.includes('/Encrypt')
  }
  return false
}

function contradictsName(extension: string | null, sniffed: string | null): boolean {
  if (sniffed && EXECUTABLE_SNIFFS.has(sniffed)) return extension !== `.${sniffed}`
  if (!extension) return false
  const expected = EXPECTED_SNIFFS[extension]
  if (expected) return sniffed === null || !expected.includes(sniffed)
  if (TEXT_EXTENSIONS.has(extension)) return sniffed !== null && !TEXTUAL_SNIFFS.has(sniffed)
  return false
}

export function riskFlagsOf(
  bytes: Uint8Array,
  extension: string | null,
  sniffed: string | null,
  accepted: ReadonlySet<string>,
  depth: number
): PartRiskFlag[] {
  const flags: PartRiskFlag[] = []
  const isAccepted = extension !== null && accepted.has(extension)
  if (!isAccepted) flags.push('type_not_accepted')
  const encrypted = isEncryptedFile(bytes, extension, sniffed)
  if (encrypted) flags.push('encrypted')
  else if (contradictsName(extension, sniffed)) flags.push('type_mismatch')
  if (isAccepted && extension && MACRO_EXTENSIONS.has(extension)) flags.push('macro')
  if (depth > 0) flags.push('forwarded_inner')
  return flags
}
