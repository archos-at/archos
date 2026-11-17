import { normalizeFolderName } from '@/lib/projects/folders'

const VIENNA = 'Europe/Vienna'
const MAX_FOLDER_NAME = 120
const MAX_FILENAME = 240

export interface MailAddress {
  name: string
  address: string
}

export function mailTimestamp(iso: string | null): string {
  if (!iso) return 'ohne Datum'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'ohne Datum'
  const parts = new Intl.DateTimeFormat('de-AT', {
    timeZone: VIENNA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}.${part('minute')}`
}

export function mailFolderName(when: string | null, sender: MailAddress | null): string {
  const stamp = mailTimestamp(when)
  const who = cleanSegment(sender?.name || sender?.address || '') || 'Unbekannt'
  return `${stamp} – ${who}`.slice(0, MAX_FOLDER_NAME).trim()
}

export function numbered(name: string, n: number): string {
  if (n <= 1) return name
  const suffix = ` (${n})`
  return `${name.slice(0, MAX_FOLDER_NAME - suffix.length).trim()}${suffix}`
}

export function numberedFilename(filename: string, n: number): string {
  if (n <= 1) return filename
  const suffix = ` (${n})`
  const dot = filename.lastIndexOf('.')
  const extension = dot > 0 && filename.length - dot <= 12 ? filename.slice(dot) : ''
  const stem = extension ? filename.slice(0, dot) : filename
  return `${stem.slice(0, MAX_FILENAME - suffix.length - extension.length).trim()}${suffix}${extension}`
}

const RESERVED = new Set(['con', 'prn', 'aux', 'nul'])

const MAX_OUTLOOK_DEPTH = 12

export function outlookFolderPath(segments: readonly string[]): string {
  const names = segments.map(outlookFolderName)
  if (names.length <= MAX_OUTLOOK_DEPTH) return names.join('/')
  const kept = names.slice(0, MAX_OUTLOOK_DEPTH - 1)
  const folded = outlookFolderName(names.slice(MAX_OUTLOOK_DEPTH - 1).join(' – '))
  return [...kept, folded].join('/')
}

export function outlookFolderName(raw: string): string {
  const name = cleanSegment(raw).slice(0, MAX_FOLDER_NAME).trim() || 'Ordner'
  return RESERVED.has(name.toLowerCase()) || /^\.+$/.test(name) ? `${name}_` : name
}

export function attachmentFilename(mailFolder: string, original: string): string {
  const name = cleanSegment(original) || 'Anhang'
  const full = `${mailFolder} – ${name}`
  if (full.length <= MAX_FILENAME) return full
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
  return `${full.slice(0, MAX_FILENAME - extension.length).trim()}${extension}`
}

export function archiveFolderName(filename: string): string {
  const stem = filename.replace(/\.(pst|ost)$/i, '')
  return outlookFolderName(stem) || 'Outlook-Archiv'
}

const MAX_PARTY_NAME = 120

export function archiveThreadName(party: MailAddress | null, at: Date, unknown: string): string {
  const who = cleanSegment(party?.name || party?.address || '').slice(0, MAX_PARTY_NAME).trim() || unknown
  const stamp = mailTimestamp(at.toISOString())
  const day = stamp === 'ohne Datum' ? '' : stamp.slice(0, 10)
  return day ? `${who} ${day}` : who
}

function oneLine(value: string): string {
  return value.replace(/[\s\x1c-\x1f\x85]+/g, ' ').trim()
}

function cleanSegment(raw: string): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '-')
  return normalizeFolderName(oneLine(flat))
}
