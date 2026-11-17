import { OFFICE_TIME_ZONE } from '@/lib/format'
import type { Locale } from '@/i18n/config'

export const MAIL_THREAD_RENDER_VERSION = 3

export interface MailThreadRenderCopy {
  unverifiedDomain: string
  fromArchive: string
  unknownSender: string
  dateTime: (at: Date) => string
  date: (at: Date) => string
  summary: (count: number, first: Date, last: Date) => string
  continues: (name: string) => string
  received: (at: Date) => string
  dateOutOfRange: string
  replyTo: string
  forwardedBy: string
  to: string
  cc: string
  more: (count: number) => string
  meeting: string
  cancelled: string
  until: string
  attachments: string
  filedIn: (folderPath: string) => string
  unnamedAttachments: (count: number) => string
  quoteIn: (heading: string) => string
  noText: string
  truncated: string
}

function viennaParts(at: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: OFFICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00'
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') }
}

const germanDate = (at: Date) => {
  const p = viennaParts(at)
  return `${p.day}.${p.month}.${p.year}`
}
const germanDateTime = (at: Date) => {
  const p = viennaParts(at)
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}
const isoDate = (at: Date) => {
  const p = viennaParts(at)
  return `${p.year}-${p.month}-${p.day}`
}
const isoDateTime = (at: Date) => {
  const p = viennaParts(at)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

export const MAIL_THREAD_RENDER_COPY: Readonly<Record<Locale, MailThreadRenderCopy>> = {
  de: {
    unverifiedDomain: 'Domain nicht bestätigt',
    fromArchive: 'aus dem Outlook-Archiv',
    unknownSender: 'Unbekannt',
    dateTime: germanDateTime,
    date: germanDate,
    summary: (count, first, last) =>
      `E-Mail-Verlauf · ${count === 1 ? '1 E-Mail' : `${count} E-Mails`} · ` +
      (germanDate(first) === germanDate(last) ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`),
    continues: (name) => `Fortsetzung von „${name}“`,
    received: (at) => {
      const p = viennaParts(at)
      return `eingegangen ${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`
    },
    dateOutOfRange: 'Das Datum der E-Mail war nicht plausibel; sie ist nach dem Eingang eingeordnet.',
    replyTo: 'Antwort auf',
    forwardedBy: 'Weitergeleitet von',
    to: 'An',
    cc: 'Cc',
    more: (count) => `und ${count} weitere`,
    meeting: 'Termin',
    cancelled: 'abgesagt',
    until: 'bis',
    attachments: 'Anhänge',
    filedIn: (folderPath) => `abgelegt in ${folderPath}`,
    unnamedAttachments: (count) =>
      count === 1 ? '1 Anhang nur im Original' : `${count} Anhänge nur im Original`,
    quoteIn: (heading) => `Zitat aus der E-Mail vom ${heading}`,
    noText: '(ohne Text)',
    truncated: '(gekürzt; der ganze Text steht im Original)',
  },
  en: {
    unverifiedDomain: 'domain not verified',
    fromArchive: 'from the Outlook archive',
    unknownSender: 'Unknown',
    dateTime: isoDateTime,
    date: isoDate,
    summary: (count, first, last) =>
      `Mail thread · ${count === 1 ? '1 mail' : `${count} mails`} · ` +
      (isoDate(first) === isoDate(last) ? isoDate(first) : `${isoDate(first)} to ${isoDate(last)}`),
    continues: (name) => `Continues “${name}”`,
    received: (at) => `received ${isoDateTime(at)}`,
    dateOutOfRange: "The mail's date was not plausible; it is placed by its receipt.",
    replyTo: 'Reply to',
    forwardedBy: 'Forwarded by',
    to: 'To',
    cc: 'Cc',
    more: (count) => `and ${count} more`,
    meeting: 'Meeting',
    cancelled: 'cancelled',
    until: 'to',
    attachments: 'Attachments',
    filedIn: (folderPath) => `filed in ${folderPath}`,
    unnamedAttachments: (count) =>
      count === 1 ? '1 attachment only in the original' : `${count} attachments only in the original`,
    quoteIn: (heading) => `Quoted from the mail of ${heading}`,
    noText: '(no text)',
    truncated: '(shortened; the whole text is in the original)',
  },
}
