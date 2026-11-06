/**
 * The office's base knowledge (ADR-0158): its licensed standards, commentaries,
 * authority directives, guidelines and laws as Archiv documents with edition,
 * territory, authority, licence and last check. See `projects.ts` for the shape
 * and `docs/architecture/agent-surface.md` for the rules.
 *
 * An agent that sorts an office's knowledge (an outside agent over MCP, or the
 * office's own colleague) reads the office shelf, proposes an entry per document
 * with the values it read, and the person confirms. Upload is the office shelf's
 * own operation; search is the knowledge search over the office shelf.
 */

import {
  confirmEntryBodySchema,
  entryParamsSchema,
  listEntriesQuerySchema,
  proposeEntryBodySchema,
  recordCheckBodySchema,
  updateEntryBodySchema,
} from '@/lib/base-knowledge/wire'
import type { AgentOperation } from '../operation'

const ENTRY =
  'An entry is one office shelf document read as base knowledge: its `values` (kind, designation, edition, territories, ' +
  'a directive’s authorities, licence), `status` (proposed until a person confirms) and `freshness` (last check, overdue).'

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
      'Changes a confirmed entry’s values; the earlier values stay in its history. 409 for a proposal. ' +
      'Needs org:office_shelf:manage.',
    method: 'PATCH',
    path: '/api/base-knowledge/[entryId]',
    params: entryParamsSchema,
    body: updateEntryBodySchema,
    load: () => import('@/app/api/base-knowledge/[entryId]/route'),
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
] as const satisfies readonly AgentOperation[]

export type BaseKnowledgeOperationName = (typeof baseKnowledgeOperations)[number]['name']
