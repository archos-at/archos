import { z } from 'zod'
import {
  knowledgeDisplayTitleSchema,
  knowledgeDocClassSchema,
  reingestKnowledgeSchema,
} from '@/lib/platform/platform-wire'
import type { AgentOperation } from '../operation'
import { MAX_UPLOAD_BYTES, uploadBodySchemaWith } from '../upload-wire'

const fileNameParams = z.object({
  fileName: z
    .string()
    .describe('The base-corpus file name, exactly as the knowledge corpus status lists it (knowledge-corpus operations).'),
})

export const platformBaseCorpusOperations = [
  {
    name: 'platform-knowledge-document-delete',
    domain: 'platform',
    summary: 'Delete a base-corpus document',
    description:
      'Removes a PDF from the shared base corpus for every organization: stored file, registry entry and indexed chunks. It cannot be undone. ' +
      'A file a platform record names as its text is refused (409) until that request is rolled back or rejected. The file name comes from platform-knowledge-base-get.',
    method: 'DELETE',
    path: '/api/platform/knowledge/documents/[fileName]',
    params: fileNameParams,
    destructive: true,
    load: () => import('@/app/api/platform/knowledge/documents/[fileName]/route'),
  },
  {
    name: 'platform-knowledge-title-update',
    domain: 'platform',
    summary: 'Rename a base-corpus document’s display title',
    description:
      'Sets the title users see on citation chips for a base-corpus document, with no re-ingest. An empty or null title ' +
      'restores the default. Returns `{ fileName, displayTitle }`.',
    method: 'PATCH',
    path: '/api/platform/knowledge/documents/[fileName]/display-title',
    params: fileNameParams,
    body: knowledgeDisplayTitleSchema,
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/documents/[fileName]/display-title/route'),
  },
  {
    name: 'platform-knowledge-doc-class-update',
    domain: 'platform',
    summary: 'Reclassify a base-corpus document',
    description:
      'Sets the document type (`doc_class`) of a base-corpus document; it takes effect in retrieval at once with no re-ingest. ' +
      'Returns `{ fileName, docClass }`.',
    method: 'PATCH',
    path: '/api/platform/knowledge/documents/[fileName]/doc-class',
    params: fileNameParams,
    body: knowledgeDocClassSchema,
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/documents/[fileName]/doc-class/route'),
  },
  {
    name: 'platform-knowledge-reingest',
    domain: 'platform',
    summary: 'Force a rebuild of chosen base-corpus documents',
    description:
      'Rebuilds the chunks of the named base-corpus documents even if the PDF is unchanged, which is what a change to how ' +
      'chunks are built needs. For new or changed files only, use platform-knowledge-sync.',
    method: 'POST',
    path: '/api/platform/knowledge/reingest',
    body: reingestKnowledgeSchema,
    idempotent: true,
    destructive: true,
    load: () => import('@/app/api/platform/knowledge/reingest/route'),
  },
  {
    name: 'platform-knowledge-sync',
    domain: 'platform',
    summary: 'Re-sync the base corpus incrementally',
    description:
      'Re-ingests new or changed PDFs of the shared base corpus; unchanged files are skipped by hash. Returns the sync result.',
    method: 'POST',
    path: '/api/platform/knowledge/sync',
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/sync/route'),
  },
  {
    name: 'platform-knowledge-document-upload',
    domain: 'platform',
    summary: 'Upload a PDF or ZIP to the base corpus',
    description:
      `Adds a PDF, or a ZIP of PDFs, to the base corpus store. Up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB per call ` +
      'through the agent door. Send `body.files[0]` as { name, mimeType, contentBase64 }; `body.fields.doc_class` presets the document type ' +
      'of a single PDF. Ingestion runs in the background: the answer is `pending`, follow it with the corpus status operations. ' +
      'No country reads a file added here; attach an edition’s text in its change request with platform-knowledge-text-import or -text-upload instead. Other bytes under a file a platform record names are refused with NAME_TAKEN: a named text changes only in a change request. Platform owners only.',
    method: 'POST',
    path: '/api/platform/knowledge/documents',
    body: uploadBodySchemaWith({
      doc_class: z.string().max(100).optional().describe('The document type for a single PDF; omit to let ingestion decide.'),
    }),
    bodyEncoding: 'multipart',
    load: () => import('@/app/api/platform/knowledge/documents/route'),
  },
] as const satisfies readonly AgentOperation[]
