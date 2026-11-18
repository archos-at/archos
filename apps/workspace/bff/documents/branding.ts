import { z } from 'zod'
import { AI_GENERATOR_NAME } from '@/lib/ai-provenance'
import { PRODUCT_NAME } from '@/lib/brand'
import { defaultLocale, isLocale, locales, type Locale } from '@/i18n/config'
import { translatorFor } from '@/i18n/namespace'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import { getOrgSettings } from '@/lib/organizations/service'

export const ORGANIZATION_BRANDING_SETTINGS_KEY = 'documentBranding'

export interface DocumentBrandingTemplate {
  productName: string
  tagline: string
  header: string
  headerWithoutOrganization: string
  footer: string
  prose: string
  disclaimer: string
}

export interface PlatformDocumentBranding {
  logo: string | null
  copy: Record<Locale, DocumentBrandingTemplate>
}

export interface DocumentBranding {
  productName: string
  tagline: string
  headerLine: string
  footerLine: string
  prose: string
  disclaimer: string
  logo: string | null
  aiGeneratorName: string
  aiDisclosure: string
}

export const PLATFORM_DOCUMENT_BRANDING: PlatformDocumentBranding = {
  logo: null,
  copy: {
    de: {
      productName: PRODUCT_NAME,
      tagline: 'Die KI-Plattform für Architektur- und Planungsbüros',
      header: 'Erstellt mit {product} für {organization}',
      headerWithoutOrganization: 'Erstellt mit {product}',
      footer: '{product} · Entwurf, nicht freigegeben',
      prose:
        'Dieses Dokument hat {product} verfasst. Es ist ein Arbeitsstand und keine ' +
        'Freigabe: Die fachliche Verantwortung für den Inhalt trägt die Person, die ihn ' +
        'freigibt — vorher trägt sie niemand.',
      disclaimer:
        'Maßgeblich sind die geltenden Rechtsvorschriften in der jeweils gültigen Fassung.',
    },
    en: {
      productName: PRODUCT_NAME,
      tagline: 'The AI platform for architecture and planning practices',
      header: 'Created with {product} for {organization}',
      headerWithoutOrganization: 'Created with {product}',
      footer: '{product} · Draft, not approved',
      prose:
        '{product} wrote this document. It is a working draft and not an approval: ' +
        'responsibility for its content rests with the person who approves it, and until ' +
        'then it rests with nobody.',
      disclaimer: 'The applicable regulations, in their version in force, are what governs.',
    },
  },
}

const templateOverrideSchema = z.object({
  productName: z.string().min(1).optional(),
  tagline: z.string().optional(),
  header: z.string().optional(),
  headerWithoutOrganization: z.string().optional(),
  footer: z.string().optional(),
  prose: z.string().optional(),
  disclaimer: z.string().optional(),
})

export const documentBrandingOverrideSchema = z.object({
  logo: z.string().nullish(),
  copy: z
    .object({
      de: templateOverrideSchema.optional(),
      en: templateOverrideSchema.optional(),
    })
    .optional(),
})

export type DocumentBrandingOverride = z.infer<typeof documentBrandingOverrideSchema>

export function mergeBrandingOverride(
  base: PlatformDocumentBranding,
  override: DocumentBrandingOverride | null,
): PlatformDocumentBranding {
  if (!override) return base

  const copy = {} as Record<Locale, DocumentBrandingTemplate>
  for (const locale of locales) {
    copy[locale] = { ...base.copy[locale], ...(override.copy?.[locale] ?? {}) }
  }
  return {
    logo: override.logo === undefined ? base.logo : (override.logo ?? null),
    copy,
  }
}

type TemplateValues = Partial<Record<'product' | 'organization', string>>

function fillTemplate(template: string, values: TemplateValues): string {
  return template.replace(
    /\{(product|organization)\}/g,
    (match, name: 'product' | 'organization') => values[name] ?? match,
  )
}

interface OrganizationBrandingSettings {
  override: DocumentBrandingOverride | null
  defaultLocale: Locale | null
}

const NO_BRANDING_SETTINGS: OrganizationBrandingSettings = { override: null, defaultLocale: null }

async function readOrganizationBrandingSettings(
  organizationId: string | null | undefined,
): Promise<OrganizationBrandingSettings> {
  if (!organizationId) return NO_BRANDING_SETTINGS

  try {
    const row = await getOrgSettings(organizationId)
    const defaultLocale = isLocale(row.defaultLocale) ? row.defaultLocale : null
    const stored = row.settings[ORGANIZATION_BRANDING_SETTINGS_KEY]
    if (stored === undefined || stored === null) return { override: null, defaultLocale }

    const parsed = documentBrandingOverrideSchema.safeParse(stored)
    if (parsed.success) return { override: parsed.data, defaultLocale }

    console.error('[documents] organization document-branding override is malformed', {
      organizationId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    })
    return { override: null, defaultLocale }
  } catch (error) {
    console.error('[documents] could not read the organization document branding', {
      organizationId,
      cause: error instanceof Error ? error.name : 'unknown',
    })
    return NO_BRANDING_SETTINGS
  }
}

export async function loadOrganizationBrandingOverride(
  organizationId: string | null | undefined,
): Promise<DocumentBrandingOverride | null> {
  return (await readOrganizationBrandingSettings(organizationId)).override
}

export interface ResolveDocumentBrandingInput {
  organizationId?: string | null
  organizationName?: string | null
  locale?: Locale | null
}

export async function resolveDocumentBranding(
  input: ResolveDocumentBrandingInput,
): Promise<DocumentBranding> {
  const settings = await readOrganizationBrandingSettings(input.organizationId)
  const locale = input.locale ?? settings.defaultLocale ?? defaultLocale
  const branding = mergeBrandingOverride(PLATFORM_DOCUMENT_BRANDING, settings.override)
  const template = branding.copy[locale] ?? branding.copy[defaultLocale]

  const organization = input.organizationName?.trim()
  const disclose = translatorFor(answerExportCopy, locale, 'aiDisclosure')
  const values: TemplateValues = { product: template.productName, organization }

  return {
    productName: template.productName,
    tagline: fillTemplate(template.tagline, values),
    headerLine: fillTemplate(
      organization ? template.header : template.headerWithoutOrganization,
      values,
    ),
    footerLine: fillTemplate(template.footer, values),
    prose: fillTemplate(template.prose, values),
    disclaimer: fillTemplate(template.disclaimer, values),
    logo: branding.logo,
    aiGeneratorName: AI_GENERATOR_NAME,
    aiDisclosure: organization
      ? disclose('withOrganization', { organization })
      : disclose('withoutOrganization'),
  }
}
