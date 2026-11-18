import 'server-only'
import { z } from 'zod'
import { getBackendUrl } from '@/lib/backend-url'
import { internalServiceHeaders } from '@/lib/internal-auth'

export const MAIL_READ_TIMEOUT_MS = 90_000

const quotedBlockSchema = z.object({ header: z.string().max(4096), text: z.string().max(524_288) })

const calendarEventSchema = z.object({
  method: z.string().max(40).nullable(),
  summary: z.string().max(500).nullable(),
  start: z.string().max(64).nullable(),
  end: z.string().max(64).nullable(),
  all_day: z.boolean(),
  location: z.string().max(500).nullable(),
  status: z.string().max(40).nullable(),
  organizer_name: z.string().max(300).nullable(),
  uid: z.string().max(500).nullable(),
  sequence: z.number().int().nullable(),
  recurring: z.boolean(),
})

export const MAIL_READ_UNREADABLE_REASONS = [
  'message_too_large',
  'html_too_large',
  'rtf_too_large',
  'calendar_too_large',
  'calendar_malformed',
  'timeout',
  'failed',
] as const

const wireMailReadSchema = z.object({
  reader_version: z.number().int().positive(),
  body_source: z.enum(['plain', 'html', 'rtf', 'none']),
  own_text: z.string().max(524_288),
  own_text_truncated: z.boolean(),
  split: z.boolean(),
  signature_removed: z.boolean(),
  quoted: z.array(quotedBlockSchema).max(50),
  quoted_truncated: z.boolean(),
  calendar: z.array(calendarEventSchema).max(20),
  calendar_truncated: z.boolean(),
  encrypted: z.boolean(),
  unreadable_reasons: z.array(z.enum(MAIL_READ_UNREADABLE_REASONS)),
  unreadable: z.boolean(),
})

export const mailReadSchema = z.object({
  readerVersion: z.number().int().positive(),
  bodySource: z.enum(['plain', 'html', 'rtf', 'none']),
  ownText: z.string().max(524_288),
  ownTextTruncated: z.boolean(),
  split: z.boolean(),
  signatureRemoved: z.boolean(),
  quoted: z.array(quotedBlockSchema).max(50),
  quotedTruncated: z.boolean(),
  calendar: z
    .array(
      z.object({
        method: z.string().nullable(),
        summary: z.string().nullable(),
        start: z.string().nullable(),
        end: z.string().nullable(),
        allDay: z.boolean(),
        location: z.string().nullable(),
        status: z.string().nullable(),
        organizerName: z.string().nullable(),
        recurring: z.boolean(),
      }),
    )
    .max(20),
  calendarTruncated: z.boolean(),
  encrypted: z.boolean(),
  unreadableReasons: z.array(z.enum(MAIL_READ_UNREADABLE_REASONS)),
  unreadable: z.boolean(),
})
export type MailRead = z.infer<typeof mailReadSchema>

export class MailReadRefusedError extends Error {
  constructor(status: number) {
    super(`the mail reader refused the request (${status})`)
    this.name = 'MailReadRefusedError'
  }
}

export async function readMail(fileRef: string, timeoutMs: number = MAIL_READ_TIMEOUT_MS): Promise<MailRead> {
  const baseUrl = getBackendUrl()
  const response = await fetch(`${baseUrl}/v1/mail/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalServiceHeaders(baseUrl) },
    body: JSON.stringify({ file_ref: fileRef }),
    redirect: 'manual',
    signal: AbortSignal.timeout(Math.min(timeoutMs, MAIL_READ_TIMEOUT_MS)),
  })
  if (response.status === 422) throw new MailReadRefusedError(422)
  if (!response.ok) throw new Error(`the mail reader answered ${response.status}`)
  return fromWire(wireMailReadSchema.parse(await response.json()))
}

function fromWire(read: z.infer<typeof wireMailReadSchema>): MailRead {
  return {
    readerVersion: read.reader_version,
    bodySource: read.body_source,
    ownText: read.own_text,
    ownTextTruncated: read.own_text_truncated,
    split: read.split,
    signatureRemoved: read.signature_removed,
    quoted: read.quoted,
    quotedTruncated: read.quoted_truncated,
    calendar: read.calendar.map((event) => ({
      method: event.method,
      summary: event.summary,
      start: event.start,
      end: event.end,
      allDay: event.all_day,
      location: event.location,
      status: event.status,
      organizerName: event.organizer_name,
      recurring: event.recurring,
    })),
    calendarTruncated: read.calendar_truncated,
    encrypted: read.encrypted,
    unreadableReasons: read.unreadable_reasons,
    unreadable: read.unreadable,
  }
}

export function redactRead(read: MailRead, redact: (text: string) => string): MailRead {
  const optional = (text: string | null) => (text === null ? null : redact(text))
  return {
    ...read,
    ownText: redact(read.ownText),
    quoted: read.quoted.map((block) => ({ header: redact(block.header), text: redact(block.text) })),
    calendar: read.calendar.map((event) => ({
      ...event,
      summary: optional(event.summary),
      location: optional(event.location),
      organizerName: optional(event.organizerName),
    })),
  }
}

export function unreadableRead(reason: (typeof MAIL_READ_UNREADABLE_REASONS)[number]): MailRead {
  return {
    readerVersion: 1,
    bodySource: 'none',
    ownText: '',
    ownTextTruncated: false,
    split: false,
    signatureRemoved: false,
    quoted: [],
    quotedTruncated: false,
    calendar: [],
    calendarTruncated: false,
    encrypted: false,
    unreadableReasons: [reason],
    unreadable: true,
  }
}
