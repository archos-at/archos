/**
 * The office's base knowledge (ADR-0163): its licensed standards, commentaries,
 * authority directives, guidelines and laws as Archiv documents with edition,
 * territory, authority, licence and last check. See `projects.ts` for the shape
 * and `docs/architecture/agent-surface.md` for the rules.
 *
 * An agent that sorts an office's knowledge (an outside agent over MCP, or the
 * office's own colleague) reads the office shelf, proposes an entry per document
 * with the values it read, and the person confirms. Upload is the office shelf's
 * own operation; search is the knowledge search over the office shelf.
 */

import { z } from 'zod'
import {
  confirmEntryBodySchema,
  licenceEntryBodySchema,
  entryParamsSchema,
  listEntriesQuerySchema,
  proposeEntryBodySchema,
  recordCheckBodySchema,
  updateEntryBodySchema,
} from '@/lib/base-knowledge/wire'
import type { AgentOperation } from '../operation'
import { uploadBodySchemaWith } from '../upload-wire'

const ENTRY =
  'An entry is an office shelf document read as base knowledge: `values`, `status` (proposed until confirmed), ' +
  '`textUse` and `freshness`.'

export const baseKnowledgeOperations = [
  {
    name: 'base-knowledge-list',
    domain: 'knowledge',
    summary: 'List the office’s base knowledge: its standards, commentaries and directives',
    description:
      ENTRY + ' Only confirmed entries reach answers. Any member may read.',
    method: 'GET',
    path: '/api/base-knowledge',
    query: listEntriesQuerySchema,
    load: () => import('@/app/api/base-knowledge/route'),
  },
  {
    name: 'base-knowledge-get',
    domain: 'knowledge',
    summary: 'Read one base-knowledge entry',
    description: ENTRY + ' Any member may read.',
    method: 'GET',
    path: '/api/base-knowledge/[entryId]',
    params: entryParamsSchema,
    load: () => import('@/app/api/base-knowledge/[entryId]/route'),
  },
  {
    name: 'base-knowledge-propose',
    domain: 'knowledge',
    summary: 'Propose an office shelf document as base knowledge',
    description:
      'Records what an office shelf document is (a licensed standard, a commentary, an authority directive, a guideline, ' +
      'a law): give the values you read from its masthead; the rest come from its reading. It reaches no answer until a ' +
      'person confirms it. 409 when the document already has an entry. Needs org:office_shelf:manage.',
    method: 'POST',
    path: '/api/base-knowledge',
    body: proposeEntryBodySchema,
    load: () => import('@/app/api/base-knowledge/route'),
  },
  {
    name: 'base-knowledge-upload',
    domain: 'knowledge',
    summary: 'Upload a standard, commentary or directive as base knowledge',
    description:
      'Stores one file on the office shelf and proposes it from its file name. Its text is not read (no index, no ' +
      'summary) until a person confirms the copy. Send `body.files[0]` as { name, mimeType, contentBase64 }. ' +
      'Needs org:office_shelf:manage.',
    method: 'POST',
    path: '/api/base-knowledge/upload',
    body: uploadBodySchemaWith({
      folderId: z.string().optional().describe('From office-shelf-folder-list; omit for the root.'),
    }),
    bodyEncoding: 'multipart',
    load: () => import('@/app/api/base-knowledge/upload/route'),
  },
  {
    name: 'base-knowledge-confirm',
    domain: 'knowledge',
    summary: 'Confirm a proposed base-knowledge entry',
    description:
      'Confirms a proposed entry, with any corrections: answers in this office draw on it from then on, and ' +
      'it counts as the first check. A licensed copy needs `licenceAttested`. Needs org:office_shelf:manage.',
    method: 'POST',
    path: '/api/base-knowledge/[entryId]/confirm',
    params: entryParamsSchema,
    body: confirmEntryBodySchema,
    personDecides: true,
    load: () => import('@/app/api/base-knowledge/[entryId]/confirm/route'),
  },
  {
    name: 'base-knowledge-update',
    domain: 'knowledge',
    summary: 'Change a confirmed base-knowledge entry',
    description:
      'Changes a confirmed entry’s descriptive values; the earlier values stay in its history. The licence is not ' +
      'among them: only the person changes it. 409 for a proposal. Needs org:office_shelf:manage.',
    method: 'PATCH',
    path: '/api/base-knowledge/[entryId]',
    params: entryParamsSchema,
    body: updateEntryBodySchema,
    load: () => import('@/app/api/base-knowledge/[entryId]/route'),
  },
  {
    name: 'base-knowledge-licence-set',
    domain: 'knowledge',
    summary: 'Change a confirmed copy’s licence',
    description:
      'Sets the licence class and the office’s statements: `licenceAttested` (needed to make a copy licensed) and ' +
      '`aiProcessingAttested` (a licensed copy’s text reaches a model only with it; false withdraws it). 409 for a ' +
      'proposal. Needs org:office_shelf:manage.',
    method: 'PUT',
    path: '/api/base-knowledge/[entryId]/licence',
    params: entryParamsSchema,
    body: licenceEntryBodySchema,
    personDecides: true,
    load: () => import('@/app/api/base-knowledge/[entryId]/licence/route'),
  },
  {
    name: 'base-knowledge-check-record',
    domain: 'knowledge',
    summary: 'Record that a base-knowledge entry was checked',
    description:
      'Records that somebody checked whether the copy is still the edition in force, and the result; anything but ' +
      '`current` keeps it overdue. Needs org:office_shelf:manage.',
    method: 'POST',
    path: '/api/base-knowledge/[entryId]/checks',
    params: entryParamsSchema,
    body: recordCheckBodySchema,
    load: () => import('@/app/api/base-knowledge/[entryId]/checks/route'),
  },
  {
    name: 'base-knowledge-remove',
    domain: 'knowledge',
    summary: 'Remove a base-knowledge entry and its document',
    description:
      'Deletes the entry’s document and with it the entry, its history, its checks and its passages in search. ' +
      'Needs org:office_shelf:manage.',
    method: 'DELETE',
    path: '/api/base-knowledge/[entryId]',
    params: entryParamsSchema,
    load: () => import('@/app/api/base-knowledge/[entryId]/route'),
  },
  {
    name: 'organization-countries-get',
    domain: 'organization',
    summary: 'Read the office’s home country and the countries it is entitled to',
    description:
      'Its home country, and each country the platform entitled it to: the countries whose platform base knowledge ' +
      '(listed norms, authorities, directives) its answers draw on. Any member may read.',
    method: 'GET',
    path: '/api/organization/countries',
    load: () => import('@/app/api/organization/countries/route'),
  },
] as const satisfies readonly AgentOperation[]

export type BaseKnowledgeOperationName = (typeof baseKnowledgeOperations)[number]['name']
