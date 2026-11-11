/**
 * A project's base knowledge (ADR-0173, design §5.4, §5.5): `GET` → the
 * knowledge context the turn reads (gate, chains, editions with their roles,
 * procedures, packs) and the newest confirmed Steckbrief. Thin handler; the
 * logic lives in `@/lib/base-knowledge/context/operations`.
 */

import { apiRoute } from '@/lib/api/handler'
import { readProjectBase } from '@/lib/base-knowledge/context/operations'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => readProjectBase(session, params.id),
  { authz: { enforcedBy: 'readProjectBase (requireProjectAccess project:view)' } },
)
