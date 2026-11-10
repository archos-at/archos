/**
 * Base knowledge in time (ADR-0171): which edition of a work applied on a date
 * or to a permit procedure. See `projects.ts` for the shape and
 * `docs/architecture/agent-surface.md` for the rules.
 */

import { asOfQuerySchema } from '@/lib/base-knowledge/wire/time'
import type { AgentOperation } from '../operation'

export const baseKnowledgeTimeOperations = [
  {
    name: 'base-knowledge-edition-as-of',
    domain: 'knowledge',
    summary: 'Which edition of a law or norm applied on a date or to a permit procedure',
    description:
      'Answers "what applied when this was submitted" with the edition named. Ask by `asOf`, by `projectId` and ' +
      '`procedureId` (profile facts filed_on@p1, decided_on@p1, …), or by giving the procedure. The node’s ' +
      'reference-date rule and the editions’ transitions decide. `undetermined` says what is missing; an unknown ' +
      'date is never taken as today.',
    method: 'GET',
    path: '/api/base-knowledge/editions/as-of',
    query: asOfQuerySchema,
    load: () => import('@/app/api/base-knowledge/editions/as-of/route'),
  },
] as const satisfies readonly AgentOperation[]
