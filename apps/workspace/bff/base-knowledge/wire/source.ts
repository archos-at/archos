import { z } from 'zod'
import { SOURCE_FORMATS, SOURCE_PROTOCOLS } from '@/shared/vocabularies.generated'
import { LICENCE_CLASSES, MONITOR_KINDS, SOURCE_DATA_FLOWS } from './vocab'

export const DESIGNATION_KEY = 'designation'

export const identifierSchemeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((scheme) => scheme !== DESIGNATION_KEY, 'the designation is the work’s own field, not a scheme')

export type SourceProtocol = (typeof SOURCE_PROTOCOLS)[number]
export type SourceFormat = (typeof SOURCE_FORMATS)[number]

export const CONFIGURED_SOURCE_LICENCES = ['public_open', 'public_restricted'] as const satisfies readonly (typeof LICENCE_CLASSES)[number][]

export const REFUSED_CREDENTIAL_HEADERS = [
  'host',
  'cookie',
  'set-cookie',
  'connection',
  'keep-alive',
  'content-length',
  'content-type',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'via',
  'forwarded',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'accept',
  'accept-language',
  'if-none-match',
  'if-modified-since',
  'user-agent',
] as const

export const sourceCredentialSchema = z
  .object({
    header: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]{1,40}$/)
      .refine(
        (header) => {
          const name = header.toLowerCase()
          return !(REFUSED_CREDENTIAL_HEADERS as readonly string[]).includes(name) && !name.startsWith('x-forwarded-') && !name.startsWith('proxy-')
        },
        'a header that routes, frames or proxies the request, or that the guard sets itself, carries no key',
      )
      .describe('The header the key is sent in, e.g. X-Api-Key or Authorization.'),
    prefix: z.string().max(20).default('').describe('Written before the key, e.g. "Bearer " (with its space).'),
  })
  .strict()

export const sourceKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[a-z0-9]+){1,6}$/, 'a source id such as at-ris: the country in lower case, then a name')
  .max(60)

const hostSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'an exact lower-case DNS name such as www.ris.bka.gv.at')

const argsSchema = z.record(z.string().regex(/^\w{1,40}$/), z.string().max(500))

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const recordedResponseSchema = z
  .object({
    contentType: z.string().min(1).max(120).describe('e.g. text/html; charset=utf-8, application/geo+json or application/pdf.'),
    body: z.string().max(500_000).describe('The body as the source served it: the text itself, or base64 for a binary body.'),
    encoding: z
      .enum(['utf-8', 'base64'])
      .default('utf-8')
      .describe('utf-8 for a text body as it came; base64 for a binary one (a PDF), within the same length.'),
  })
  .strict()
  .refine((response) => response.encoding !== 'base64' || BASE64.test(response.body), {
    path: ['body'],
    message: 'a base64 body is standard padded base64 (RFC 4648), with no line breaks',
  })

const capturedResponseSchema = z
  .object({
    captureId: z
      .uuid()
      .nullable()
      .describe(
        'The id of a fetched capture of this URL, in this change request, through this source. null while it is not ' +
          'taken: the draft is written so its hosts can be fetched, and validate fails until the record names the capture.',
      ),
  })
  .strict()

export type SourceFixtureResponse = z.infer<typeof recordedResponseSchema> | z.infer<typeof capturedResponseSchema>

export const isCapturedResponse = (response: SourceFixtureResponse): response is z.infer<typeof capturedResponseSchema> => 'captureId' in response

export const sourceFixtureSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
    operation: z.string().regex(/^[a-z_]{1,40}$/).describe('The access type operation, e.g. document, search, features.'),
    args: argsSchema.default({}),
    responses: z
      .record(z.url().max(2000), z.union([recordedResponseSchema, capturedResponseSchema]))
      .refine((responses) => Object.keys(responses).length > 0, 'a fixture records at least one response')
      .describe(
        'Every URL the operation requests, with the response recorded for it: `{contentType, body, encoding}` for a ' +
          'small text or JSON response you copied, or `{captureId}` for a document the platform captured (a PDF: ' +
          'format pdf_document reads the capture’s pages).',
      ),
    expect: z
      .record(z.string().regex(/^[a-z_]{1,30}$/), z.unknown())
      .describe('What the engine must make of it: title, min_passages, anchors, contains, version (as public_sources.fixtures reads them).'),
  })
  .strict()

export const sourceTermsSchema = z
  .object({
    url: z.url().max(2000).describe('The terms page. Its hash is watched when it lies on one of the source’s hosts.'),
    licence: z
      .enum(CONFIGURED_SOURCE_LICENCES)
      .describe('public_open or public_restricted. A licensed source is no record: its text may not be kept here (ADR-0164).'),
    attribution: z.string().trim().max(500).default('').describe('The attribution the terms require, verbatim.'),
    checked: z.iso.date().describe('The day a person last read the terms.'),
  })
  .strict()

export const sourceMonitorSchema = z
  .object({
    kind: z.enum(MONITOR_KINDS).default('sha256'),
    intervalHours: z.number().int().min(1).max(744).default(24),
    probe: z
      .object({ operation: z.string().regex(/^[a-z_]{1,40}$/), args: argsSchema.default({}) })
      .strict()
      .optional()
      .describe('What the monitor fetches to notice a change; a source without one is not watched.'),
  })
  .strict()
  .superRefine((monitor, context) => {
    if (monitor.kind !== 'none' && !monitor.probe)
      context.addIssue({ code: 'custom', path: ['probe'], message: `a ${monitor.kind} monitor names what it fetches (probe)` })
  })

export const sourceRecordFields = {
  key: sourceKeySchema,
  title: z.string().trim().min(1).max(200),
  territoryId: z
    .string()
    .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'ISO 3166 such as XA or XA-1')
    .describe('The territory the source publishes for; its country is the request’s.'),
  protocol: z.enum(SOURCE_PROTOCOLS),
  format: z.enum(SOURCE_FORMATS),
  hosts: z.array(hostSchema).min(1).max(20).describe('Every host it may reach. Usable by this request’s tests for 24 hours, by everyone once published.'),
  copyHosts: z
    .array(hostSchema)
    .max(20)
    .default([])
    .describe('Sites that republish its texts: never fetched, never one of hosts.'),
  dataFlow: z
    .enum(SOURCE_DATA_FLOWS)
    .default('public_only')
    .describe('site_keyed when a site point (a bbox, a coordinate) is sent: publishing it needs a privacy reviewer.'),
  identifiers: z
    .record(identifierSchemeSchema, z.object({ query: z.string().min(1).max(80) }).strict())
    .default({})
    .describe(
      'How a work’s identifier is read from the address of a passage at this source, by the scheme the knowledge records name it under: {"<scheme>": {"query": "<query parameter>"}}. A cited passage finds its work, and so its role, by it.',
    ),
  terms: sourceTermsSchema,
  monitor: sourceMonitorSchema.default({ kind: 'none', intervalHours: 24 }),
  access: z.record(z.string(), z.unknown()).describe('The protocol’s configuration (see public_sources.access).'),
  engine: z.record(z.string(), z.unknown()).default({}).describe('The format engine’s configuration.'),
  credential: sourceCredentialSchema
    .optional()
    .describe('For a keyed source: where its key goes. The key itself is set with platform-knowledge-source-credential-set, never here.'),
  fixtures: z.array(sourceFixtureSchema).min(1).max(10).describe('Recorded exchanges that prove the record with no live call.'),
  lookup: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'How a law lookup reads this source, in snake case (see public_sources.lookup): the language, the locus grammar of its texts, the collections its search offers, the territory filter and the wording. Without it, no lookup reads the source.',
    ),
}

export type SourceRecordValues = z.infer<z.ZodObject<typeof sourceRecordFields>>

export function sourceConfigOf(record: SourceRecordValues): Record<string, unknown> {
  return {
    id: record.key,
    title: record.title,
    territory: record.territoryId,
    protocol: record.protocol,
    format: record.format,
    hosts: record.hosts,
    ...((record.copyHosts ?? []).length > 0 ? { copy_hosts: record.copyHosts } : {}),
    data_flow: record.dataFlow,
    ...(Object.keys(record.identifiers ?? {}).length > 0 ? { identifiers: record.identifiers } : {}),
    terms: { url: record.terms.url, licence: record.terms.licence, attribution: record.terms.attribution, checked: record.terms.checked },
    monitor: {
      kind: record.monitor.kind,
      interval_hours: record.monitor.intervalHours,
      ...(record.monitor.probe ? { probe: record.monitor.probe } : {}),
    },
    ...(record.credential ? { credential: record.credential } : {}),
    access: record.access,
    engine: record.engine,
    ...(record.lookup ? { lookup: record.lookup } : {}),
    fixtures: record.fixtures.map((fixture) => ({
      name: fixture.name,
      operation: fixture.operation,
      args: fixture.args,
      responses: Object.fromEntries(
        Object.entries(fixture.responses).map(([url, response]) => [
          url,
          isCapturedResponse(response)
            ? { capture_id: response.captureId }
            : { content_type: response.contentType, text: response.body, encoding: response.encoding },
        ]),
      ),
      expect: fixture.expect,
    })),
  }
}
