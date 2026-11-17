import { S3Client, type GetObjectCommand, type PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BadRequestError } from "@/lib/api/errors";
import { INBOUND_MAIL_STAGING_SEGMENT, MAIL_ORIGINALS_SEGMENT } from "@/lib/inbound-mail/inbound-mail-vocabulary";

const credentials = {
  accessKeyId: process.env.SEAWEED_ACCESS_KEY || "",
  secretAccessKey: process.env.SEAWEED_SECRET_KEY || "",
};

export const LOCAL_STORAGE_ENDPOINT = "http://localhost:8333";

type Env = Record<string, string | undefined>;

export function storageEndpoint(which: "internal" | "public" = "internal", env: Env = process.env): string {
  const configured = (which === "public" ? env.SEAWEED_PUBLIC_ENDPOINT?.trim() : "") || env.SEAWEED_ENDPOINT?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SEAWEED_ENDPOINT is not set, so object storage is not configured. Set it to the S3-compatible endpoint " +
        "(docs/deployment/environment-variables.md); without it the AWS SDK would send every object to AWS S3."
    );
  }
  return LOCAL_STORAGE_ENDPOINT;
}

const endpointFor = (which: "internal" | "public") => async () => ({ url: new URL(storageEndpoint(which)) });

export const s3Client = new S3Client({
  endpoint: endpointFor("internal"),
  region: "us-east-1",
  credentials,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export function presignForBackend(command: GetObjectCommand | PutObjectCommand, expiresIn: number): Promise<string> {
  return getSignedUrl(s3Client, command, { expiresIn });
}

export const signingS3Client = new S3Client({
  endpoint: endpointFor("public"),
  region: "us-east-1",
  credentials,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const bucketAdminS3Client = new S3Client({
  endpoint: endpointFor("internal"),
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.SEAWEED_TENANT_ADMIN_ACCESS_KEY || credentials.accessKeyId,
    secretAccessKey: process.env.SEAWEED_TENANT_ADMIN_SECRET_KEY || credentials.secretAccessKey,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const bucketName = process.env.SEAWEED_BUCKET || "grid-documents";

export function storageKeySegment(raw: string): string {
  const flattened = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '_')
  const segment = flattened.trim().slice(0, 255).trim()
  if (!segment) return 'unnamed'
  const reserved = /^\.+$/.test(segment) || RESERVED_DERIVED_SEGMENTS.has(segment.toLowerCase())
  return reserved ? `_${segment}`.slice(0, 255) : segment
}

const RESERVED_DERIVED_SEGMENTS: ReadonlySet<string> = new Set([
  '_thumb.jpg',
  '_render.pdf',
  '_img',
  '_bim',
  '_text',
  'mail-imports',
  INBOUND_MAIL_STAGING_SEGMENT,
  MAIL_ORIGINALS_SEGMENT,
])

export function buildStorageKey(
  organizationId: string,
  projectId: string,
  documentId: string,
  filename: string,
  folderPath?: string | null,
): string {
  return shelfStorageKey(`org/${organizationId}/project/${projectId}`, documentId, filename, folderPath)
}

export function buildOfficeShelfStorageKey(
  organizationId: string,
  documentId: string,
  filename: string,
  folderPath?: string | null,
): string {
  return shelfStorageKey(`org/${organizationId}/office_shelf`, documentId, filename, folderPath)
}

function shelfStorageKey(
  ownerPrefix: string,
  documentId: string,
  filename: string,
  folderPath?: string | null,
): string {
  const folder = folderPath
    ? `${folderPath.split('/').filter(Boolean).map(storageKeySegment).join('/')}/`
    : ''
  return `${ownerPrefix}/${folder}doc/${documentId}/${storageKeySegment(filename)}`
}

export function buildSessionStorageKey(
  organizationId: string,
  conversationId: string,
  documentId: string,
  filename: string,
): string {
  return `org/${organizationId}/session/${storageKeySegment(conversationId)}/doc/${documentId}/${storageKeySegment(filename)}`
}

export function buildThumbnailStorageKey(storageKey: string): string | null {
  return derivedSiblingKey(storageKey, '_thumb.jpg')
}

function derivedSiblingKey(storageKey: string, name: string): string | null {
  const idx = storageKey.lastIndexOf('/')
  if (idx <= 0 || idx === storageKey.length - 1) return null
  const key = `${storageKey.slice(0, idx)}/${name}`
  return key === storageKey ? null : key
}

export function buildRenditionStorageKey(storageKey: string): string | null {
  return derivedSiblingKey(storageKey, '_render.pdf')
}

export const MAX_STORED_IMAGES_PER_DOCUMENT = 64

export function buildImageDerivedPrefix(storageKey: string): string | null {
  const idx = storageKey.lastIndexOf('/')
  if (idx <= 0 || idx === storageKey.length - 1) return null
  return `${storageKey.slice(0, idx)}/_img/`
}

export function buildImageStorageKey(storageKey: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_STORED_IMAGES_PER_DOCUMENT) return null
  const prefix = buildImageDerivedPrefix(storageKey)
  if (!prefix) return null
  return `${prefix}${index}.jpg`
}

export const PAGE_TEXT_PARTS = ['pages.md', 'index.json', 'parsed.json'] as const
export type PageTextPart = (typeof PAGE_TEXT_PARTS)[number]

export function buildPageTextPrefix(storageKey: string): string | null {
  const idx = storageKey.lastIndexOf('/')
  if (idx <= 0 || idx === storageKey.length - 1) return null
  return `${storageKey.slice(0, idx)}/_text/`
}

export function buildPageTextStorageKey(storageKey: string, part: string): string | null {
  if (!(PAGE_TEXT_PARTS as readonly string[]).includes(part)) return null
  const prefix = buildPageTextPrefix(storageKey)
  return prefix ? `${prefix}${part}` : null
}

export const BASE_CORPUS_KEY_PREFIX = 'base-corpus/'

export function buildBaseCorpusStorageKey(fileName: string): string {
  const valid =
    fileName.length >= 1 &&
    fileName.length <= 255 &&
    fileName.toLowerCase().endsWith('.pdf') &&
    !/[/\\\u0000-\u001f\u007f]/.test(fileName) &&
    fileName !== '.' &&
    fileName !== '..'
  if (!valid) {
    throw new BadRequestError('A .pdf file name of at most 255 characters, without path separators or control characters, is required')
  }
  return `${BASE_CORPUS_KEY_PREFIX}${fileName}`
}
