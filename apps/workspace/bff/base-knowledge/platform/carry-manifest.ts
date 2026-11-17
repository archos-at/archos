import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { DOC_CLASSES } from '@/lib/knowledge/doc-class'
import { bundleOf } from './release-transfer'
import type { ReleaseBundle } from './release-wire'
import { countryIdSchema } from './wire'

export const CARRY_MANIFEST_FORMAT = 'knowledge-carry/1'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 in lower-case hex')

const textLabelSchema = z.object({
  docClass: z.enum(DOC_CLASSES).nullable(),
  displayTitle: z.string().trim().min(1).max(300).nullable(),
})

const carriedBundleSchema = z.object({
  file: z.string().regex(/^[a-z]{2}-\d+\.json\.gz$/, 'a bundle file such as at-142.json.gz'),
  countryId: countryIdSchema,
  seq: z.number().int().min(0),
  sha256: sha256Schema.describe('Of the uncompressed bundle JSON.'),
  records: z.number().int().min(1),
  captures: z.number().int().min(0),
  texts: z.record(z.string().regex(/^[^/\\]{1,200}\.pdf$/), textLabelSchema),
})
export type CarriedBundle = z.infer<typeof carriedBundleSchema>

export const carryManifestSchema = z.object({
  format: z.literal(CARRY_MANIFEST_FORMAT),
  sourceDeployment: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  bundles: z.array(carriedBundleSchema).max(20),
})
export type CarryManifest = z.infer<typeof carryManifestSchema>

export class CarryRefused extends Error {
  override name = 'CarryRefused'
}

export function parseManifest(json: unknown): CarryManifest {
  const parsed = carryManifestSchema.safeParse(json)
  if (!parsed.success) throw new CarryRefused(`the carry manifest is not one this build reads: ${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('/')}: ${issue.message}`).join('; ')}`)
  const countries = parsed.data.bundles.map((entry) => entry.countryId)
  if (new Set(countries).size !== countries.length) throw new CarryRefused('the carry manifest names a country twice; one bundle per country')
  return parsed.data
}

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export function verifiedBundle(entry: CarriedBundle, file: Buffer): ReleaseBundle {
  let json: Buffer
  try {
    json = gunzipSync(file, { maxOutputLength: 256 * 1024 * 1024 })
  } catch {
    throw new CarryRefused(`${entry.file} is not a gzip file`)
  }
  const digest = sha256Hex(json)
  if (digest !== entry.sha256) throw new CarryRefused(`${entry.file} has sha256 ${digest}; the manifest names ${entry.sha256}`)
  const bundle = bundleOf(json)
  const facts: [string, unknown, unknown][] = [
    ['country', bundle.countryId, entry.countryId],
    ['release seq', bundle.releaseSeq, entry.seq],
    ['record count', bundle.records.length, entry.records],
    ['capture count', bundle.captures.length, entry.captures],
    ['texts', bundle.texts.map((text) => text.fileName).sort().join(','), Object.keys(entry.texts).sort().join(',')],
  ]
  const wrong = facts.find(([, held, named]) => held !== named)
  if (wrong) throw new CarryRefused(`${entry.file} holds ${wrong[0]} ${String(wrong[1])}; the manifest names ${String(wrong[2])}`)
  return bundle
}

export function checkCarryOrder(entries: readonly { countryId: string; requires: readonly string[] }[]): void {
  entries.forEach((entry, index) => {
    const later = entries.slice(index + 1).map((other) => other.countryId)
    const early = entry.requires.find((country) => later.includes(country))
    if (early) throw new CarryRefused(`${entry.countryId} requires ${early}, which the manifest carries after it; list ${early} first`)
  })
}
