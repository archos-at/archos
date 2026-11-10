/**
 * The knowledge context's operations (ADR-0173): how far the base knowledge
 * goes, a report of wrong law, a project's base and its confirmation. See `projects.ts` for the shape and
 * `docs/architecture/agent-surface.md` for the rules.
 */

import { z } from 'zod'
import {
  baseKnowledgeReportBodySchema,
  coverageQuerySchema,
  projectBaseConfirmBodySchema,
} from '@/lib/base-knowledge/context/operations-wire'
import type { AgentOperation } from '../operation'

const projectParams = z.object({ id: z.string().describe('The project id, from project-list.') })

export const knowledgeContextOperations = [
  {
    name: 'coverage-get',
    domain: 'knowledge',
    summary: 'Read how far the base knowledge goes in each country the office is entitled to',
    description:
      'Per entitled country its coverage level (none, open, core, full) and every territory that states its own. ' +
      '`open` is official sources nobody curated; `core` reviewed codes; `full` adds classification and reference dates. ' +
      'Any member may read.',
    method: 'GET',
    path: '/api/base-knowledge/coverage',
    query: coverageQuerySchema,
    load: () => import('@/app/api/base-knowledge/coverage/route'),
  },
  {
    name: 'base-knowledge-report',
    domain: 'knowledge',
    summary: 'Report wrong law in the base knowledge to the platform',
    description:
      'Opens a draft change request in the country for a platform reviewer: the work or edition, the answer that showed it, ' +
      'and what is wrong in one sentence, on the person’s own yes. Only for a country the office is entitled to. ' +
      'Changes nothing an answer reads.',
    method: 'POST',
    path: '/api/base-knowledge/reports',
    body: baseKnowledgeReportBodySchema,
    personDecides: true,
    load: () => import('@/app/api/base-knowledge/reports/route'),
  },
  {
    name: 'project-base-get',
    domain: 'projects',
    links: 'project',
    summary: 'Read a project’s base knowledge: gate, chain, editions and their roles',
    description:
      'What answers about the project’s site rest on: the gate (organization_unplaced, site_unknown, not_entitled, ' +
      'knowledge_unavailable, or coverage none to full), each leaf’s chain, every edition with its role, qualifier and ' +
      'freshness, the procedures, the packs with their release sequence, and the newest confirmation. Needs project:view.',
    method: 'GET',
    path: '/api/projects/[id]/base',
    params: projectParams,
    readOnly: true,
    load: () => import('@/app/api/projects/[id]/base/route'),
  },
  {
    name: 'project-base-confirm',
    domain: 'projects',
    links: 'project',
    summary: 'Confirm a project’s base knowledge as it reads now',
    description:
      'Stores the base project-base-get shows, resolved again on the server, on the person’s own yes. Send the packs you ' +
      'read; a newer release since refuses it (409) so the person confirms what is current. Needs project:edit.',
    method: 'POST',
    path: '/api/projects/[id]/base/confirmations',
    params: projectParams,
    body: projectBaseConfirmBodySchema,
    personDecides: true,
    load: () => import('@/app/api/projects/[id]/base/confirmations/route'),
  },
] as const satisfies readonly AgentOperation[]
