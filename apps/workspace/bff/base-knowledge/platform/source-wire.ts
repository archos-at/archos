/**
 * The wire of the source operations on the platform door (ADR-0174): what
 * `source-test`, `source-status` and `source-credential-set` take. Pure zod,
 * shared by the routes and the catalog.
 */

import { z } from 'zod'
import { sourceKeySchema } from '@/lib/base-knowledge/wire/source'

export const sourceParamsSchema = z.object({
  sourceKey: sourceKeySchema.describe('The source id, e.g. xa-gazette (its record id is source:<id>).'),
})

export const sourceTestBodySchema = z.object({
  changeRequestId: z
    .uuid()
    .optional()
    .describe('Test the source as this open change request proposes it (its testing hosts); absent: as published.'),
  live: z
    .boolean()
    .default(false)
    .describe('Also fetch the monitor probe once, live, through the fetcher; nothing is stored.'),
})

export const sourceStatusQuerySchema = z.object({
  sourceKey: sourceKeySchema.optional().describe('One source; all of them when absent.'),
})

export const sourceCredentialBodySchema = z.object({
  secret: z
    .string()
    .min(8)
    .max(4000)
    .describe('The key the source’s terms issue. Write-only: no operation returns it, only its last four characters.'),
})
