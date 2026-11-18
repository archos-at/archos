import { z } from 'zod'

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

export const MAX_UPLOAD_FILES = 1

export const MAX_UPLOAD_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const contentBase64 = z
  .string()
  .min(1)
  .max(MAX_UPLOAD_BASE64_CHARS)
  .regex(BASE64, 'contentBase64 must be standard base64')
  .describe(`The file's bytes as standard base64 (RFC 4648, with padding), at most ${MAX_UPLOAD_BYTES} bytes decoded.`)

export const uploadFileSchema = z.object({
  name: z.string().trim().min(1).max(255).describe('The file name, with its extension, e.g. "Grundriss EG.pdf".'),
  mimeType: z
    .string()
    .trim()
    .max(255)
    .optional()
    .describe('The media type, e.g. "application/pdf". Defaults to application/octet-stream.'),
  contentBase64,
})
export type UploadFile = z.infer<typeof uploadFileSchema>

const fieldValue = z.string().max(2_000)

export function uploadBodySchemaWith<Shape extends Record<string, z.ZodType>>(fields: Shape) {
  const object = z.object(fields).strict().describe('The route’s text fields, sent beside the file as form parts.')
  const allOptional = Object.values(fields).every((field) => field.isOptional())
  return z.object({
    files: z.array(uploadFileSchema).min(1).max(MAX_UPLOAD_FILES).describe('The file to upload. Exactly one file.'),
    fields: allOptional ? object.optional() : object,
  })
}

export const documentUploadFields = {
  originPath: z
    .string()
    .max(2_000)
    .optional()
    .describe('Where the file sat before upload, e.g. "Drawings/GF/floor-plan.pdf". Only for a folder upload; it is screened by name.'),
  screeningRelease: z
    .literal('name')
    .optional()
    .describe('Send "name" only when a reviewer released this file’s name from the upload screening.'),
  uploadBatchId: z
    .string()
    .guid()
    .optional()
    .describe('The batch uuid given to upload-batch-open, to file this upload under that batch.'),
} satisfies Record<string, z.ZodType>

export const uploadBodySchema = z.object({
  files: z.array(uploadFileSchema).min(1).max(MAX_UPLOAD_FILES).describe('The file to upload. Exactly one file.'),
  fields: z.record(z.string(), fieldValue).optional().describe('Text fields sent beside the file as form parts.'),
})

export const rawBodySchema = z.object({ contentBase64 })

export interface UploadBody {
  readonly files: readonly UploadFile[]
  readonly fields?: Record<string, string | undefined>
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64.test(value) || value.length > MAX_UPLOAD_BASE64_CHARS) return null
  const buffer = Buffer.from(value, 'base64')
  if (buffer.byteLength > MAX_UPLOAD_BYTES) return null
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return bytes
}
