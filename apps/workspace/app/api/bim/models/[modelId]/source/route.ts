import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/api/handler'
import { getModelSource } from '@/lib/bim/model-service'

type Params = { modelId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    const source = await getModelSource(session, params.modelId)
    return NextResponse.json(source, { headers: { 'Cache-Control': 'no-store' } })
  },
  {
    authz: {
      enforcedBy:
        'getModelSource -> getAccessibleModel (ifc-models flag + requireProjectAccess project:view, or org membership for Archiv models)',
    },
  }
)
