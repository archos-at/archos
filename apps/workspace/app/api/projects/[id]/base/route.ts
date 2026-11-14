/**
 * A project's base knowledge (ADR-0173, design §5.4, §5.5): `GET` → the
 * knowledge context the turn reads (gate, chains, editions with their roles,
 * procedures, packs) and the newest confirmed Steckbrief; `?asOf=` resolves it
 * on that day instead of the turn's own. Thin handler; the
 * logic lives in `@/lib/base-knowledge/context/operations`.
 */

import { apiRoute, parseQuery } from '@/lib/api/handler'
import { readProjectBase } from '@/lib/base-knowledge/context/operations'
import { projectBaseQuerySchema } from '@/lib/base-knowledge/context/operations-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => readProjectBase(session, params.id, parseQuery(request, projectBaseQuerySchema).asOf),
  { authz: { enforcedBy: 'readProjectBase (requireProjectAccess project:view)' } },
)
