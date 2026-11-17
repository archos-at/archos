/**
 * A country's release as one self-describing bundle (rollover-to-prod, step 2): exported from the deployment that
 * reviewed and published it, imported into another as a draft change request that is reviewed there again. Shared
 * by the routes and the catalog (ADR-0055).
 *
 * Records travel as the proposals they were published from: they name each other by key (`<type>:<key>`, a
 * territory by its id), which re-resolves on any deployment. Captures travel with their text, so KC-6 checks every
 * quote there again. A text travels as its name, URL and sha256, never its bytes.
 */

import { z } from 'zod'
import { countryIdSchema, proposedRecordSchema } from './wire'

export const RELEASE_BUNDLE_FORMAT = 'knowledge-release/1'

/** The most records one bundle carries: a country is a few hundred. */
export const MAX_BUNDLE_RECORDS = 5000

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 in lower-case hex')

export const releaseExportParamsSchema = z.object({
  countryId: countryIdSchema.describe('The country whose stable release is exported, e.g. "XA".'),
})

const bundleCaptureSchema = z.object({
  captureId: z.uuid().describe('Its id on the exporting deployment; the citations name it, and the import gives it a new one.'),
  basis: z.enum(['fetched', 'operator_supplied']).describe('How it was taken there.'),
  url: z.url().max(2000),
  finalUrl: z.string().max(2000).nullable(),
  contentType: z.string().max(200).nullable(),
  sha256: sha256Schema.describe('Of the bytes taken there.'),
  bytes: z.number().int().min(0),
  text: z.string().max(2_000_000).nullable().describe('The text every quote was checked against.'),
  retrievedAt: z.iso.datetime({ offset: true }),
})

const bundleTextSchema = z.object({
  manifestationKey: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255).describe('The file the manifestation names: `<manifestationKey>-<12 hex of its sha256>.pdf`.'),
  sha256: sha256Schema.describe('Of the PDF; the bytes attached on the importing deployment must have it.'),
  url: z.string().max(2000).nullable().describe('Where it was fetched from; null for an upload.'),
  sourceId: z.string().max(200).nullable().describe('The source it was fetched through; null for an upload.'),
})

export const releaseBundleSchema = z.object({
  format: z.literal(RELEASE_BUNDLE_FORMAT),
  countryId: countryIdSchema,
  releaseSeq: z.number().int().min(0).describe('The newest stable release move of these records on the exporting deployment.'),
  records: z.array(proposedRecordSchema).min(1).max(MAX_BUNDLE_RECORDS),
  captures: z.array(bundleCaptureSchema).max(MAX_BUNDLE_RECORDS),
  texts: z.array(bundleTextSchema).max(MAX_BUNDLE_RECORDS),
  requires: z
    .array(z.object({ recordId: z.string(), countryId: z.string().nullable() }))
    .max(MAX_BUNDLE_RECORDS)
    .describe('Records of other countries these records name: released on the importing deployment first.'),
})
export type ReleaseBundle = z.infer<typeof releaseBundleSchema>
export type BundleText = z.infer<typeof bundleTextSchema>

/** The import's form fields, beside the bundle file (`files[0]`). */
export const releaseImportFields = {
  title: z.string().trim().min(1).max(200).optional().describe('The draft’s title; "Import of <country> release <seq>" when absent.'),
}
export const releaseImportFieldsSchema = z.object(releaseImportFields)
export type ReleaseImportBody = { bundle: ReleaseBundle; title?: string }

export interface ReleaseImportResult {
  changeRequestId: string
  /** `created`: a new draft; `unchanged`: this bundle was imported already into that request, nothing was written. */
  status: 'created' | 'unchanged'
  /** Where that request stands: `draft` for a new one; an earlier import may be submitted, approved or published. */
  requestStatus: string
  records: number
  captures: number
  /** The texts to attach before the draft validates, each with the sha256 its bytes must have. */
  texts: BundleText[]
}
