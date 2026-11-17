/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { de } from './de'
import { en } from './en'
import { SUBPROCESSOR_PAGE } from './subprocessors.generated'
import { legalSlugs, type LegalDocument } from '../types'

const flatten = (doc: LegalDocument): string =>
  doc.sections
    .flatMap((section) => [
      section.heading ?? '',
      ...(section.paragraphs ?? []),
      ...(section.list ?? []),
      ...(section.table ? [...section.table.headers, ...section.table.rows.flat()] : []),
      section.notice ?? '',
    ])
    .join('\n')

describe.each([
  ['de', de],
  ['en', en],
] as const)('legal content (%s)', (_locale, content) => {
  it('names PostHog and its EU hosting in the privacy policy', () => {
    const privacy = flatten(content.privacy)
    expect(privacy).toContain('PostHog, Inc.')
    expect(privacy).toContain('Frankfurt')
    expect(privacy).toContain('Langfuse')
  })

  it('lists PostHog in the processor table', () => {
    const processors = content.subprocessors.sections[0]?.table?.rows ?? []
    expect(processors.some((row) => row[0] === 'PostHog, Inc.')).toBe(true)
  })

  it('states the ph_ storage keys and no longer claims strictly-necessary-only cookies', () => {
    const cookies = content.privacy.sections.find((section) => /7\. /.test(section.heading ?? ''))
    const text = (cookies?.paragraphs ?? []).join('\n')
    expect(text).toContain('ph_')
    expect(text).not.toMatch(/ausschließlich technisch notwendig|only strictly necessary/i)
    expect(text).not.toMatch(/kein Cookie-Einwilligungsbanner|no cookie consent banner/i)
  })

  it('does not claim that email or name reach product analytics', () => {
    expect(flatten(content.privacy)).toMatch(/E-Mail-Adresse und Ihr Name werden nicht|email address and name are not sent/)
  })

  it.each(legalSlugs)('%s renders no bracketed placeholder', (slug) => {
    const doc = content[slug]
    expect(`${doc.title}\n${doc.intro ?? ''}\n${flatten(doc)}`).not.toMatch(/\[[^\]]*\]/)
  })

  it('names exactly what the product reads of a held mail, and that no model reads its original (ADR-0137)', () => {
    const privacy = flatten(content.privacy)
    expect(privacy).toMatch(/Dateinamen der Anhänge|attachments’ file names/)
    expect(privacy).toMatch(/Betreff \(maskiert|subject \(masked/)
    expect(privacy).toMatch(/Absender-Domain|sender’s domain/)
    expect(privacy).toMatch(/Original \(\.eml\) einer E-Mail erhält kein KI-Modell|No AI model receives a mail’s original/)
  })

  it('lists Cloudflare as the transit of project mail and ClamAV as self-hosted (ADR-0138, ADR-0157)', () => {
    const processors = content.subprocessors.sections[0]?.table?.rows ?? []
    const cloudflare = processors.find((row) => row[0] === 'Cloudflare, Inc.')
    expect(cloudflare?.[1]).toMatch(/Email Routing/)
    const selfHosted = content.subprocessors.sections[1]?.table?.rows ?? []
    expect(selfHosted.some((row) => row[0] === 'ClamAV')).toBe(true)
  })

  it('shows the register’s processor rows, all of them, in order', () => {
    const locale = content === de ? 'de' : 'en'
    const rows = content.subprocessors.sections[0]?.table?.rows ?? []
    expect(rows.map((row) => row[0])).toEqual(SUBPROCESSOR_PAGE[locale].processors.rows.map((row) => row[0]))
    expect(rows.flat().join('\n')).not.toContain('{productName}')
  })

  it('names address search, dictation and the audit trail’s document names in the privacy policy', () => {
    const privacy = flatten(content.privacy)
    expect(privacy).toContain('komoot GmbH')
    expect(privacy).toContain('ElevenLabs')
    expect(privacy).toMatch(/Ereignisse zu Projekten und Dokumenten enthalten deren Namen|events about projects and documents carry their names/)
    expect(privacy).not.toMatch(/erreichen the agent|reaches the agent/)
  })

  it('has been revised since the PostHog switch', () => {
    expect(content.privacy.updated >= '2026-10-10').toBe(true)
    expect(content.subprocessors.updated >= '2026-10-10').toBe(true)
  })
})

describe('legal content parity', () => {
  it.each(legalSlugs)('%s has the same shape in German and English', (slug) => {
    const shape = (doc: LegalDocument) =>
      doc.sections.map((section) => ({
        paragraphs: section.paragraphs?.length ?? 0,
        list: section.list?.length ?? 0,
        rows: section.table?.rows.length ?? 0,
        notice: Boolean(section.notice),
      }))
    expect(shape(en[slug])).toEqual(shape(de[slug]))
  })
})
