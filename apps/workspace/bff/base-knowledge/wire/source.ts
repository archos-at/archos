/**
 * The wire of a public source as a platform record (ADR-0174, ADR-0162, design
 * §4.2): what an operator's agent proposes so a country's statute database or
 * geodata service is configured without a git change or a deploy.
 *
 * The common fields are typed here, because the database decides on them (the
 * hosts the fetcher may reach, what may flow there, how its monitor runs). The
 * protocol's `access` and the format's `engine` configuration are validated by
 * the access type and engine themselves, in `packages/public-sources`, when
 * the kit runs KC-7 through the api tier: one validator, not a second copy.
 *
 * A record's fixtures carry their recorded responses inline (a repository
 * record keeps them as files beside it), so `platform-knowledge-source-test`
 * proves the record with no live call.
 */

import { z } from 'zod'
import { LICENCE_CLASSES, MONITOR_KINDS, SOURCE_DATA_FLOWS, SOURCE_FORMATS, SOURCE_PROTOCOLS } from './vocab'

/**
 * The licences a configured source may have: its fixtures and its monitor's
 * captures keep the source's text, which licensed text never is (ADR-0164).
 */
export const CONFIGURED_SOURCE_LICENCES = ['public_open', 'public_restricted'] as const satisfies readonly (typeof LICENCE_CLASSES)[number][]

/**
 * Headers a key may never be sent under: the request's routing and framing,
 * cookies, the proxy's, and the ones the guard forwards on its own. Held again
 * by `public_sources.source.Credential`.
 */
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

/** A source's id, which is also its record key: `<iso2>-<name>` in lower case (`xa-gazette`). */
export const sourceKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[a-z0-9]+){1,6}$/, 'a source id such as at-ris: the country in lower case, then a name')
  .max(60)

/** An exact DNS name: no scheme, port or wildcard (the fetcher compares it at every redirect hop). */
const hostSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'an exact lower-case DNS name such as www.ris.bka.gv.at')

const argsSchema = z.record(z.string().regex(/^\w{1,40}$/), z.string().max(500))

/** One recorded response, inline: what the fixture run serves for the URL instead of a live call. */
const recordedResponseSchema = z
  .object({
    contentType: z.string().min(1).max(120).describe('e.g. text/html; charset=utf-8 or application/geo+json.'),
    body: z.string().max(500_000).describe('The body as the source served it (text formats only).'),
  })
  .strict()

export const sourceFixtureSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
    operation: z.string().regex(/^[a-z_]{1,40}$/).describe('The access type operation, e.g. document, search, features.'),
    args: argsSchema.default({}),
    responses: z
      .record(z.url().max(2000), recordedResponseSchema)
      .refine((responses) => Object.keys(responses).length > 0, 'a fixture records at least one response')
      .describe('Every URL the operation requests, with the response recorded for it.'),
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
  dataFlow: z
    .enum(SOURCE_DATA_FLOWS)
    .default('public_only')
    .describe('site_keyed when a site point (a bbox, a coordinate) is sent: publishing it needs a privacy reviewer.'),
  terms: sourceTermsSchema,
  monitor: sourceMonitorSchema.default({ kind: 'none', intervalHours: 24 }),
  access: z.record(z.string(), z.unknown()).describe('The protocol’s configuration (see public_sources.access).'),
  engine: z.record(z.string(), z.unknown()).default({}).describe('The format engine’s configuration.'),
  credential: sourceCredentialSchema
    .optional()
    .describe('For a keyed source: where its key goes. The key itself is set with platform-knowledge-source-credential-set, never here.'),
  fixtures: z.array(sourceFixtureSchema).min(1).max(10).describe('Recorded exchanges that prove the record with no live call.'),
}

export type SourceRecordValues = z.infer<z.ZodObject<typeof sourceRecordFields>>

/**
 * The record as `public_sources.source.Source` reads it: snake case, the key
 * as its id, the recorded responses inline. What the body's `config` keeps and
 * what the api tier validates, tests and fetches with.
 */
export function sourceConfigOf(record: SourceRecordValues): Record<string, unknown> {
  return {
    id: record.key,
    title: record.title,
    territory: record.territoryId,
    protocol: record.protocol,
    format: record.format,
    hosts: record.hosts,
    data_flow: record.dataFlow,
    terms: { url: record.terms.url, licence: record.terms.licence, attribution: record.terms.attribution, checked: record.terms.checked },
    monitor: {
      kind: record.monitor.kind,
      interval_hours: record.monitor.intervalHours,
      ...(record.monitor.probe ? { probe: record.monitor.probe } : {}),
    },
    ...(record.credential ? { credential: record.credential } : {}),
    access: record.access,
    engine: record.engine,
    fixtures: record.fixtures.map((fixture) => ({
      name: fixture.name,
      operation: fixture.operation,
      args: fixture.args,
      responses: Object.fromEntries(
        Object.entries(fixture.responses).map(([url, response]) => [url, { content_type: response.contentType, text: response.body }]),
      ),
      expect: fixture.expect,
    })),
  }
}
