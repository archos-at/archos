import { z } from 'zod'
import { modernizePlan } from './plan-vocabulary'

export const MAX_PLAN_DOCUMENTS = 20
const MAX_NAME_CHARS = 256
const MAX_TITLE_CHARS = 256
const MAX_SHELF_CHARS = 64

export const planDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_CHARS),
    title: z.string().trim().min(1).max(MAX_TITLE_CHARS).optional(),
    shelf: z.string().trim().min(1).max(MAX_SHELF_CHARS).optional(),
  })
  .strict()

export type PlanDocument = z.infer<typeof planDocumentSchema>

export const planDocumentsSchema = z.preprocess(
  modernizePlan,
  z
    .object({
      basis: z.array(planDocumentSchema).max(MAX_PLAN_DOCUMENTS).default([]),
      excluded: z.array(planDocumentSchema).max(MAX_PLAN_DOCUMENTS).default([]),
    })
    .strict()
)

export type PlanDocuments = z.infer<typeof planDocumentsSchema>

export const planDocumentLabel = (doc: PlanDocument): string => doc.title ?? doc.name

export const isEmptyPlanDocuments = (docs: PlanDocuments | null | undefined): boolean =>
  !docs || (docs.basis.length === 0 && docs.excluded.length === 0)

export function sanitizePlanDocuments(input: unknown): PlanDocuments | null {
  const parsed = z
    .object({ basis: z.array(z.unknown()).optional(), excluded: z.array(z.unknown()).optional() })
    .safeParse(modernizePlan(input))
  if (!parsed.success) return null
  const seen = new Set<string>()
  const take = (rows: unknown[] | undefined): PlanDocument[] => {
    const out: PlanDocument[] = []
    for (const raw of rows ?? []) {
      if (out.length >= MAX_PLAN_DOCUMENTS) break
      const row = typeof raw === 'string' ? { name: raw } : raw
      const doc = planDocumentSchema.safeParse(row)
      if (!doc.success) continue
      const key = doc.data.name.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(doc.data)
    }
    return out
  }
  const excluded = take(parsed.data.excluded)
  const basis = take(parsed.data.basis)
  if (basis.length === 0 && excluded.length === 0) return null
  return { basis: basis, excluded: excluded }
}
