import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute, parseQuery } from '@/lib/api/handler'
import { exportAccessibleComplianceBcf } from '@/lib/bim/model-service'
import { BIM_MAIN_USE, canonicalBimMainUse, renameLegacyBimFactNames } from '@/lib/bim/query'
import { BIM_EXPORT_LIMIT } from '@/lib/limits'

type Params = { id: string }

const paramsObjectSchema = z
  .object({
    modelId: z.guid().optional(),
    model: z.string().trim().min(1).max(255).optional(),
    buildingClass: z.coerce.number().int().min(1).max(5).nullish().catch(null),
    mainUse: z.preprocess(canonicalBimMainUse, z.enum(BIM_MAIN_USE).nullish()).catch(null),
  })
  .refine((value) => Boolean(value.modelId ?? value.model), {
    message: 'modelId or model is required',
  })

const paramsSchema = z.preprocess(renameLegacyBimFactNames, paramsObjectSchema)

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const input = parseQuery(request, paramsSchema)

    const bcf = await exportAccessibleComplianceBcf(session, params.id, {
      modelId: input.modelId ?? null,
      modelName: input.model ?? null,
      buildingClass: input.buildingClass ?? null,
      mainUse: input.mainUse ?? null,
    })

    return new NextResponse(new Uint8Array(bcf.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${bcf.filename}"`,
        'X-Grid-Bcf-Topics': String(bcf.topics),
        'Cache-Control': 'no-store',
      },
    })
  },
  {
    authz: {
      enforcedBy: 'exportAccessibleComplianceBcf (ifc-models flag + project:view + model tenancy)',
    },
    limits: { rule: BIM_EXPORT_LIMIT },
  }
)
