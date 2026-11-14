/**
 * Content-aware document-kind inference for the Files card grid (WS-4).
 *
 * Pure helpers — no React, no I/O — that map a document's real metadata onto
 * one visual kind used to pick a skeleton thumbnail: floor plan (Grundriss),
 * section (Schnitt), site plan (Lageplan), official notice (Bescheid), photo,
 * building model, spreadsheet, notes/Markdown, or generic document.
 *
 * Inference order (most trustworthy signal first):
 *   0. FORMAT, for formats that ARE their kind — an `.ifc` is a building model,
 *      a `.csv` is a table and a `.md` is a written note, whatever they are
 *      named and whatever tags they carry.
 *   1. Controlled ingestion tags (backend-classified, user-correctable).
 *   2. Content type (an `image/*` is a photo, unless its name names a drawing).
 *   3. Filename heuristics (German building-domain terms + image extensions).
 *   4. Fallback: generic document.
 */

import type {
  OFFICE_RENDITION_CONTENT_TYPES,
  OFFICE_RENDITION_EXTENSIONS,
} from '@/lib/documents/preview-types'

export type DocumentKind =
  | 'floorplan'
  | 'section'
  | 'siteplan'
  | 'notice'
  | 'photo'
  | 'model'
  | 'sheet'
  | 'text'
  | 'document'

/**
 * Controlled-vocabulary tag → kind. Keys are lowercase. Tags that have no
 * distinctive skeleton (Gutachten, Vertrag, …) intentionally fall through to
 * the generic document.
 */
const TAG_KIND: Record<string, DocumentKind> = {
  grundriss: 'floorplan',
  schnitt: 'section',
  // An elevation (Ansicht) is drawn like a section face — closest skeleton.
  ansicht: 'section',
  bebauungsplan: 'siteplan',
  'flächenwidmungsplan': 'siteplan',
  lageplan: 'siteplan',
  bescheid: 'notice',
  foto: 'photo',
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg)$/
const IFC_EXT = /\.(ifc|ifczip)$/

/**
 * Formats whose BYTES settle the question, so no name and no tag can overrule
 * them. Nothing in a `.md` or a `.csv` can be a drawing, and the filename
 * heuristics below are happy to claim otherwise: `plan` matches anywhere in a
 * name, so `Projektplan.md`, `Zeitplan.csv` and `Sanierungsplanung.txt` all
 * drew a floor-plan card — walls and a door swing over a file that is prose.
 * Same shape as the `.ifc` rule, and for the same reason.
 */
const SHEET_EXT = /\.(csv|tsv|xlsx?|xlsm|ods|numbers)$/
const TEXT_EXT = /\.(md|markdown|mdx|txt|log|rst|adoc)$/
const SHEET_TYPES = [
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
]
const TEXT_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain']

export interface DocumentKindInput {
  filename: string
  contentType?: string | null
  tags?: string[] | null
}

export function inferDocumentKind({ filename, contentType, tags }: DocumentKindInput): DocumentKind {
  const lowerName = filename.toLowerCase()
  const lowerType = (contentType ?? '').toLowerCase()

  // 0. FORMAT FIRST, for the formats that are their own answer. This runs
  //    BEFORE the tag rules because a model called "Grundriss EG.ifc" is still a
  //    model — it opens in the viewer, not in a page preview — and before the
  //    filename heuristics, which would otherwise read that name as a floor
  //    plan. A spreadsheet and a Markdown note are the same case: the bytes
  //    cannot be a drawing, so neither a name nor a mis-fired ingestion tag may
  //    say they are.
  if (IFC_EXT.test(lowerName)) return 'model'
  if (SHEET_EXT.test(lowerName) || SHEET_TYPES.includes(lowerType)) return 'sheet'
  if (TEXT_EXT.test(lowerName) || TEXT_TYPES.includes(lowerType)) return 'text'

  // 1. Ingestion tags are authoritative when present.
  for (const tag of tags ?? []) {
    const kind = TAG_KIND[tag.toLowerCase()]
    if (kind) return kind
  }

  // 2. MIME type: a raster/vector image is a photo — unless its NAME says it is
  //    a scanned drawing or notice. `Grundriss_EG.jpg` drew a photo while
  //    `Grundriss_EG.pdf` drew a floor plan, the same sheet in two formats. Only
  //    the explicit terms count here, not the bare "plan" the PDF rules accept:
  //    a photo called `IMG_plan_wall.jpg` is still a photo.
  if (lowerType.startsWith('image/')) return scannedKindFromName(lowerName) ?? 'photo'

  // 3. Filename heuristics. Site-plan terms are matched before the generic
  //    "plan" pattern so "Lageplan"/"site-plan" never reads as a floor plan.
  const name = lowerName
  if (/lageplan|bebauungsplan|fl(ä|ae)chenwidmung|site.?plan/.test(name)) return 'siteplan'
  if (/schnitt|ansicht/.test(name)) return 'section'
  if (/grundriss|grundriß|floor.?plan|plan/.test(name)) return 'floorplan'
  if (/bescheid|genehmigung|permit/.test(name)) return 'notice'
  if (IMAGE_EXT.test(name) || /foto|photo/.test(name)) return 'photo'

  // 4. Default: generic text document.
  return 'document'
}

/** What an IMAGE's name says it is a scan of, by the unambiguous terms only. */
function scannedKindFromName(name: string): DocumentKind | null {
  if (/lageplan|bebauungsplan|fl(ä|ae)chenwidmung|site.?plan/.test(name)) return 'siteplan'
  if (/schnitt|ansicht/.test(name)) return 'section'
  if (/grundriss|grundriß|floor.?plan/.test(name)) return 'floorplan'
  if (/bescheid/.test(name)) return 'notice'
  return null
}

/** Uppercase display extension ("PDF", "DOCX"); empty string when there is none. */
export function fileExtensionLabel(filename: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(filename.trim())
  return match ? match[1].toUpperCase() : ''
}

/**
 * Tint (background + text CSS values) for a file-extension chip: one quiet
 * ink-on-paper tile for every format.
 *
 * It used to borrow the provenance colours by format (PDF and Word the green of
 * project knowledge, DWG and IFC the blue of building law, photos the gold of
 * the Büroablage), so a PDF chip told a reader „Projekt“ and a drawing chip
 * „Baurecht“, beside chips that meant exactly that. A format is not a signal
 * (`design-language.md`, principle 2: chroma is the source signal system's
 * alone), and the letters already say which format it is.
 */
export interface ExtChipTint {
  background: string
  color: string
}

const NEUTRAL: ExtChipTint = {
  background: 'var(--source-auto-tint, var(--muted))',
  color: 'var(--source-auto-text, var(--muted-foreground))',
}

export function extChipTint(_extLabel: string): ExtChipTint {
  return NEUTRAL
}

/**
 * What a file IS, in words a reader knows: "Word document", "Image (PNG)",
 * "DWG file" — never `application/vnd.openxmlformats-officedocument…`.
 *
 * Pure: it names a dictionary key under `files.preview.formats` and the values
 * to interpolate, and the caller translates. Resolution order:
 *   1. a known extension (the stored type is whatever the browser sent, and an
 *      empty one is stored as NULL or `application/octet-stream`),
 *   2. a known content type,
 *   3. any `image/*`, labelled by its subtype,
 *   4. the extension in caps ("DWG file"),
 *   5. the raw content type, verbatim.
 * `null` only when there is neither an extension nor a type.
 */
export type FileFormatKey =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'odText'
  | 'odSpreadsheet'
  | 'odPresentation'
  | 'rtf'
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'plainText'
  | 'ifc'
  | 'dxf'
  | 'email'
  | 'image'
  | 'extension'
  | 'raw'

export interface FileFormatMessage {
  /** Key under `files.preview.formats`. */
  key: FileFormatKey
  values?: Record<string, string>
}

type OfficeContentType = (typeof OFFICE_RENDITION_CONTENT_TYPES)[number]
type OfficeExtension = (typeof OFFICE_RENDITION_EXTENSIONS)[number]
type NamedFormat = Exclude<FileFormatKey, 'image' | 'extension' | 'raw'>

/**
 * Every office type the BFF renders (ADR-0070) must have a name here: the
 * `Record<OfficeContentType, …>` makes a new entry in `preview-types.ts` a
 * compile error until it is labelled.
 */
const OFFICE_TYPE_FORMAT: Record<OfficeContentType, NamedFormat> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-word.document.macroenabled.12': 'word',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'excel',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'powerpoint',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.oasis.opendocument.text': 'odText',
  'application/vnd.oasis.opendocument.spreadsheet': 'odSpreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'odPresentation',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
}

const TYPE_FORMAT: Record<string, NamedFormat> = {
  ...OFFICE_TYPE_FORMAT,
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/plain': 'plainText',
  'application/x-step': 'ifc',
  'application/ifc': 'ifc',
  'model/ifc': 'ifc',
  'application/dxf': 'dxf',
  'image/vnd.dxf': 'dxf',
  'message/rfc822': 'email',
  'application/vnd.ms-outlook': 'email',
}

/** Same guarantee as {@link OFFICE_TYPE_FORMAT}, for the extensions. */
const OFFICE_EXT_FORMAT: Record<OfficeExtension, NamedFormat> = {
  '.docx': 'word',
  '.docm': 'word',
  '.doc': 'word',
  '.xlsx': 'excel',
  '.xlsm': 'excel',
  '.xls': 'excel',
  '.pptx': 'powerpoint',
  '.pptm': 'powerpoint',
  '.ppt': 'powerpoint',
  '.odt': 'odText',
  '.ods': 'odSpreadsheet',
  '.odp': 'odPresentation',
  '.rtf': 'rtf',
}

const EXT_FORMAT: Record<string, NamedFormat> = {
  ...OFFICE_EXT_FORMAT,
  '.pdf': 'pdf',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'plainText',
  '.ifc': 'ifc',
  '.ifczip': 'ifc',
  // The format, not what is drawn: only its Dokumentart says a file is a plan.
  '.dxf': 'dxf',
  '.eml': 'email',
  '.msg': 'email',
}

/** Subtype spellings that read better normalised ("jpg" and "jpeg" are one format). */
const IMAGE_SUBTYPE_LABEL: Record<string, string> = { jpg: 'JPEG', 'svg+xml': 'SVG', tif: 'TIFF' }

const imageSubtypeLabel = (subtype: string): string =>
  IMAGE_SUBTYPE_LABEL[subtype] ?? subtype.split('+', 1)[0].toUpperCase()

export function fileFormatMessage(file: {
  filename?: string | null
  contentType?: string | null
}): FileFormatMessage | null {
  const rawType = file.contentType?.trim() ?? ''
  const type = rawType.split(';', 1)[0].trim().toLowerCase()
  const name = file.filename?.trim().toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : ''

  const byExt = EXT_FORMAT[ext]
  if (byExt) return { key: byExt }
  const byType = TYPE_FORMAT[type]
  if (byType) return { key: byType }
  if (IMAGE_EXT.test(name)) return { key: 'image', values: { format: imageSubtypeLabel(ext.slice(1)) } }
  if (type.startsWith('image/')) return { key: 'image', values: { format: imageSubtypeLabel(type.slice(6)) } }
  const extLabel = fileExtensionLabel(file.filename ?? '')
  if (extLabel) return { key: 'extension', values: { ext: extLabel } }
  if (rawType) return { key: 'raw', values: { type: rawType } }
  return null
}
