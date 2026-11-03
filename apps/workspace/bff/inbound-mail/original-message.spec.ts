/**
 * The original of a forward, read from what real mail programs write: Outlook
 * (Windows, Mac, the web), Gmail, Apple Mail, Thunderbird, in German and
 * English, inline and as an attached `.eml`. The fixtures and their expected
 * values are in `__fixtures__/forwards/`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inlineOriginal, originalMessage, parseForwardDate, parseMailbox } from './original-message'

const DIR = join(__dirname, '__fixtures__', 'forwards')

interface Expected {
  from?: { name: string | null; address: string | null }
  dateLocal?: string
  date?: string
  subject?: string
  to?: (string | { name: string; address: string | null })[]
  cc?: (string | { name: string; address: string | null })[]
  messageId?: string
}

const EXPECTED = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Record<string, Expected>
const raw = (name: string) => new Uint8Array(readFileSync(join(DIR, name)))

/** The outer mail of an inline fixture: a forward with its header block in the body. */
function forwardOf(name: string): Uint8Array {
  const body = readFileSync(join(DIR, name), 'utf8')
  const html = name.endsWith('.html')
  const headers = [
    'From: Anna Bauer <a.bauer@architekten-bauer.de>',
    'To: project+haus-b.token@inbox.example.test',
    'Subject: WG: weitergeleitet',
    'Date: Tue, 4 Nov 2026 11:00:00 +0100',
    'Message-ID: <fwd@architekten-bauer.de>',
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
  ]
  return new TextEncoder().encode(`${headers.join('\r\n')}\r\n\r\n${body}`)
}

const addressesOf = (list: Expected['to']) =>
  (list ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.address)).filter((a): a is string => a !== null)

/** `2026-11-03T10:15 Europe/Berlin` → the instant. */
function localInstant(dateLocal: string): number {
  const [wall] = dateLocal.split(' ')
  return new Date(`${wall}:00+01:00`).getTime()
}

const SIMPLE = Object.keys(EXPECTED).filter((name) => EXPECTED[name].from)

describe('the original of a forward', () => {
  it.each(SIMPLE)('%s names who wrote it, to whom and about what', async (name) => {
    const expected = EXPECTED[name]
    const original = name.endsWith('.eml') ? await originalMessage(raw(name), null) : await originalMessage(forwardOf(name), null)
    expect(original, name).not.toBeNull()
    expect(original?.from?.address).toBe(expected.from?.address)
    if (expected.from?.name) expect(original?.from?.name).toBe(expected.from.name)
    expect(original?.subject).toBe(expected.subject)
    expect(original?.to.map((m) => m.address).filter(Boolean)).toEqual(addressesOf(expected.to))
    expect(original?.cc.map((m) => m.address).filter(Boolean)).toEqual(addressesOf(expected.cc))
    expect(original?.source).toBe(name.endsWith('.eml') ? 'attachment' : 'inline')
  })

  it.each(SIMPLE.filter((name) => EXPECTED[name].dateLocal || EXPECTED[name].date))('%s says when it was sent', async (name) => {
    const expected = EXPECTED[name]
    const original = name.endsWith('.eml') ? await originalMessage(raw(name), null) : await originalMessage(forwardOf(name), null)
    const want = expected.date ? new Date(expected.date).getTime() : localInstant(expected.dateLocal ?? '')
    expect(original?.sentAt?.getTime()).toBe(want)
  })

  it('takes the Message-ID of an attached original, the key two forwards of one mail share', async () => {
    const original = await originalMessage(raw('15-outlook-forward-as-attachment-rfc822.eml'), null)
    expect(original?.messageId).toBe(EXPECTED['15-outlook-forward-as-attachment-rfc822.eml'].messageId)
  })

  it('reads a forward of a forward back to whoever wrote it first', async () => {
    const original = await originalMessage(forwardOf('14-nested-forward-de-en.txt'), null)
    expect(original?.from?.address).toBe('jane.doe@contractor.example.com')
  })

  it('finds no original in a mail that forwards nothing', async () => {
    expect(inlineOriginal('Sehr geehrte Frau Bauer,\n\nanbei die Pläne.\n', 'Pläne')).toBeNull()
    expect(inlineOriginal('', null)).toBeNull()
    expect(await originalMessage(new TextEncoder().encode('not a mail at all'), null)).toBeNull()
  })
})

describe('a forward date line', () => {
  it('reads a German wall-clock time in the office time zone, winter and summer', () => {
    expect(parseForwardDate('Montag, 3. November 2026 10:15')?.toISOString()).toBe('2026-11-03T09:15:00.000Z')
    expect(parseForwardDate('Montag, 6. Juli 2026 10:15')?.toISOString()).toBe('2026-07-06T08:15:00.000Z')
  })

  it('keeps a zone the line states', () => {
    expect(parseForwardDate('Mon, 3 Nov 2026 10:15:00 +0000')?.toISOString()).toBe('2026-11-03T10:15:00.000Z')
  })

  it('gives null for a line without a day', () => {
    expect(parseForwardDate('irgendwann')).toBeNull()
  })
})

describe('a mailbox as a mail program writes it', () => {
  it.each([
    ['Müller, Thomas <t.mueller@statik-mueller.de>', 'Müller, Thomas', 't.mueller@statik-mueller.de'],
    ['"Jane Doe" <Jane.Doe@contractor.example.com>', 'Jane Doe', 'jane.doe@contractor.example.com'],
    ['Thomas Müller [mailto:t.mueller@statik-mueller.de]', 'Thomas Müller', 't.mueller@statik-mueller.de'],
    ['bauamt@musterstadt.de', null, 'bauamt@musterstadt.de'],
    ['Anna Bauer', 'Anna Bauer', null],
  ])('%s', (value, name, address) => {
    expect(parseMailbox(value)).toEqual({ name, address })
  })
})
