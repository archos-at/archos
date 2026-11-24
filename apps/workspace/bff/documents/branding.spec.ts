/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrgSettings = vi.hoisted(() => vi.fn())
vi.mock('@/lib/organizations/service', () => ({ getOrgSettings }))

import { locales } from '@/i18n/config'
import {
  loadOrganizationBrandingOverride,
  mergeBrandingOverride,
  ORGANIZATION_BRANDING_SETTINGS_KEY,
  PLATFORM_DOCUMENT_BRANDING,
  resolveDocumentBranding,
} from './branding'
import { PRODUCT_NAME } from '@/lib/brand'

const noSettings = { displayName: null, defaultLocale: 'de', settings: {} }

const storedOverride = (settings: Record<string, unknown>): void => {
  getOrgSettings.mockResolvedValue({ ...noSettings, settings })
}

beforeEach(() => {
  vi.clearAllMocks()
  getOrgSettings.mockResolvedValue(noSettings)
})

describe('the platform default', () => {
  it('names the organization in the header line', async () => {
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro ZT GmbH',
      locale: 'de',
    })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME} für Musterbüro ZT GmbH`)
    expect(branding.footerLine).toBe(`${PRODUCT_NAME} · Entwurf, nicht freigegeben`)
  })

  it('names the product alone when there is no organization to name', async () => {
    const branding = await resolveDocumentBranding({ organizationName: null, locale: 'de' })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME}`)
    expect(branding.headerLine).not.toContain('{')
  })

  it('says who carries the content, which is nobody until somebody approves it', async () => {
    const branding = await resolveDocumentBranding({ organizationName: 'X', locale: 'de' })
    expect(branding.prose).toContain('Verantwortung')
    expect(branding.prose).toContain('freigibt')
    expect(branding.prose).not.toContain('{product}')
  })

  it('says a filed document is made by the product and signed off, never a draft that nobody approved', async () => {
    for (const locale of locales) {
      const filed = await resolveDocumentBranding({ organizationName: 'X', locale, filed: true })
      const draft = await resolveDocumentBranding({ organizationName: 'X', locale })
      expect(filed.footerLine).not.toBe(draft.footerLine)
      expect(filed.prose).not.toBe(draft.prose)
      expect(filed.footerLine).toContain(PRODUCT_NAME)
      expect(`${filed.footerLine} ${filed.prose}`).not.toMatch(/Entwurf|keine Freigabe|Draft|not an approval|not approved/)
    }
    const filed = await resolveDocumentBranding({ organizationName: 'X', locale: 'de', filed: true })
    expect(filed.footerLine).toBe(`Von ${PRODUCT_NAME} erstellt`)
  })

  it('keeps the draft wording for a document nobody has filed, such as a task’s report', async () => {
    const draft = await resolveDocumentBranding({ organizationName: 'X', locale: 'de', filed: false })
    expect(draft.footerLine).toBe(`${PRODUCT_NAME} · Entwurf, nicht freigegeben`)
    expect(draft.prose).toContain('keine Freigabe')
  })

  it('leaves the marking’s generator name alone, because it is an interface', async () => {
    storedOverride({
      [ORGANIZATION_BRANDING_SETTINGS_KEY]: { copy: { de: { productName: 'Bürotool' } } },
    })
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro',
      locale: 'de',
    })
    expect(branding.productName).toBe('Bürotool')
    expect(branding.aiGeneratorName).toBe(PRODUCT_NAME)
  })
})

describe('the language the document is in', () => {
  it('picks the English copy for an English reader', async () => {
    const branding = await resolveDocumentBranding({ organizationName: 'Acme', locale: 'en' })
    expect(branding.headerLine).toBe(`Created with ${PRODUCT_NAME} for Acme`)
    expect(branding.prose).toContain('responsibility for its content')
  })

  it('falls back to the app default rather than rendering nothing', async () => {
    const branding = await resolveDocumentBranding({ organizationName: 'Acme' })
    expect(branding.headerLine).toBe(`Created with ${PRODUCT_NAME} for Acme`)
  })

  it('inherits the office’s own language when the caller has none', async () => {
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro',
    })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME} für Musterbüro`)
  })

  it('lets an explicit language beat the office’s default', async () => {
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro',
      locale: 'en',
    })
    expect(branding.headerLine).toBe(`Created with ${PRODUCT_NAME} for Musterbüro`)
  })

  it('carries every field in every language the app supports', () => {
    for (const locale of locales) {
      const template = PLATFORM_DOCUMENT_BRANDING.copy[locale]
      for (const value of Object.values(template)) {
        expect(value.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the override seam', () => {
  it('lays one office’s header line over the platform copy and keeps the rest', () => {
    const merged = mergeBrandingOverride(PLATFORM_DOCUMENT_BRANDING, {
      copy: { de: { header: '{organization} · erstellt mit {product}' } },
    })
    expect(merged.copy.de.header).toBe('{organization} · erstellt mit {product}')
    expect(merged.copy.de.prose).toBe(PLATFORM_DOCUMENT_BRANDING.copy.de.prose)
    expect(merged.copy.en).toEqual(PLATFORM_DOCUMENT_BRANDING.copy.en)
  })

  it('reads the override out of the settings bag and applies it end to end', async () => {
    storedOverride({
      [ORGANIZATION_BRANDING_SETTINGS_KEY]: {
        copy: { de: { header: '{organization} · erstellt mit {product}' } },
      },
    })
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro ZT GmbH',
      locale: 'de',
    })
    expect(branding.headerLine).toBe(`Musterbüro ZT GmbH · erstellt mit ${PRODUCT_NAME}`)
    expect(branding.disclaimer).toBe(PLATFORM_DOCUMENT_BRANDING.copy.de.disclaimer)
  })

  it('keeps an organization name from rewriting the line it appears on', async () => {
    storedOverride({})
    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: '{product}',
      locale: 'de',
    })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME} für {product}`)
  })

  it('is null when nothing is stored, which is every organization today', async () => {
    expect(await loadOrganizationBrandingOverride('org_1')).toBeNull()
  })

  it('does not read anything for a deployment with no organization', async () => {
    expect(await loadOrganizationBrandingOverride(null)).toBeNull()
    expect(getOrgSettings).not.toHaveBeenCalled()
  })

  it('falls back to the platform copy when the stored override is malformed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    storedOverride({ [ORGANIZATION_BRANDING_SETTINGS_KEY]: { copy: { de: { header: 42 } } } })

    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro',
      locale: 'de',
    })
    expect(branding.headerLine).toBe(`Erstellt mit ${PRODUCT_NAME} für Musterbüro`)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('files the document anyway when the settings read throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    getOrgSettings.mockRejectedValue(new Error('connection refused'))

    const branding = await resolveDocumentBranding({
      organizationId: 'org_1',
      organizationName: 'Musterbüro',
      locale: 'de',
    })
    expect(branding.prose).toBe(
      PLATFORM_DOCUMENT_BRANDING.copy.de.prose.replaceAll('{product}', PRODUCT_NAME),
    )
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('the prose survives both formats', () => {
  const MARKDOWN_ACTIVE = /[|`*_#[\]<>]/

  it('has no Markdown in any line that is printed as prose', () => {
    for (const locale of locales) {
      const template = PLATFORM_DOCUMENT_BRANDING.copy[locale]
      for (const line of [
        template.tagline,
        template.header,
        template.headerWithoutOrganization,
        template.footer,
        template.prose,
        template.filedFooter,
        template.filedProse,
        template.disclaimer,
      ]) {
        expect(line).not.toMatch(MARKDOWN_ACTIVE)
      }
    }
  })

  it('is a block of sentences, not a wall and not a fragment', () => {
    for (const locale of locales) {
      for (const prose of [PLATFORM_DOCUMENT_BRANDING.copy[locale].prose, PLATFORM_DOCUMENT_BRANDING.copy[locale].filedProse]) {
        const sentences = prose.split(/(?<=\.)\s+/)
        expect(sentences.length).toBeGreaterThanOrEqual(2)
        expect(sentences.length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('ships no logo, so no renderer is fetching an asset at render time', () => {
    expect(PLATFORM_DOCUMENT_BRANDING.logo).toBeNull()
  })
})
