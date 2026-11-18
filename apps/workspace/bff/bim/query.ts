import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { internalRead } from '@/lib/documents/document-reader'
import {
  aggregateBimElements,
  countBimElementsByType,
  findBimElement,
  findBimModelById,
  listBimElements,
  loadBimElementsForComparison,
  loadBimElementsForSchedule,
  listBimPropertyCatalog,
  type BimModelHeader,
} from './repository'
import { complianceRun, contextOfModel } from './compliance-run'
import { compareModels } from './compare'
import { deriveProfileSuggestions } from './profile'
import { diffBimCompliance } from './rules'
import { buildQuantityTakeoff, buildRoomSchedule } from './schedule'
import { healthCaveat } from './validate'
import { buildBimElementPlan, buildBimPredicate } from './element-filter-sql'
import { groupExpression, metricExpression, metricValueExpression } from './aggregate-sql'
import { renderSummary } from './query-summary'
import type { BimQuery } from './query-schema'
import type { BimQueryResult } from './query-result'

export class BimModelNotReadyError extends ApiError {
  readonly modelStatus: BimModelHeader['status']

  constructor(status: BimModelHeader['status'], message: string) {
    super(
      status === 'failed' && /not found/i.test(message) ? 404 : 409,
      'MODEL_NOT_READY',
      message
    )
    this.name = 'BimModelNotReadyError'
    this.modelStatus = status
  }
}

export async function runBimQuery(
  request: BimQuery,
  context: { modelId: string; organizationId: string }
): Promise<BimQueryResult> {
  const model = await findBimModelById(context.modelId, context.organizationId, internalRead('reloaded'))
  if (!model) throw new BimModelNotReadyError('failed', 'Model not found')
  if (model.status !== 'ready') {
    throw new BimModelNotReadyError(
      model.status,
      model.status === 'failed'
        ? `Model extraction failed: ${model.errorMessage ?? 'unknown error'}`
        : 'Model is still being extracted'
    )
  }

  const modelBase: Omit<BimQueryResult, 'summary'> = {
    op: request.op,
    model: {
      id: model.id,
      filename: model.filename,
      schema: model.schemaVersion,
      elementCount: model.elementCount,
    },
  }

  const health = model.summary?.health ?? null
  const CAVEATED_OPS = new Set(['overview', 'types', 'elements', 'aggregate'])
  const healthNote = health && CAVEATED_OPS.has(request.op) ? healthCaveat(health) : null

  const ROW_READING_OPS = new Set([
    'types',
    'elements',
    'aggregate',
    'schedule',
    'takeoff',
    'compare',
    'compliance',
    'compliance-diff',
    'health',
    'profile',
    'properties',
  ])
  const truncatedAt = model.summary?.truncatedAt ?? null
  const capNote =
    truncatedAt !== null && ROW_READING_OPS.has(request.op)
      ? `Achtung: von diesem Modell sind nur ${truncatedAt} Bauteile gespeichert — die Datei ist größer. ` +
        `Jede Zahl aus dieser Abfrage bezieht sich auf den gespeicherten Teil, nicht auf das ganze Gebäude.`
      : null

  const caveat = [capNote, healthNote].filter(Boolean).join(' ') || null

  const finish = (partial: Omit<BimQueryResult, 'summary'>): BimQueryResult => ({
    ...partial,
    caveat,
    summary: renderSummary(request, partial),
  })

  switch (request.op) {
    case 'overview':
      return finish({ ...modelBase, overview: model.summary ?? undefined })

    case 'health':
      return finish({ ...modelBase, health: health ?? undefined })

    case 'types':
      return finish({
        ...modelBase,
        types: await countBimElementsByType(context.modelId, context.organizationId),
      })

    case 'elements': {
      const { rows, total, totalIsLowerBound } = await listBimElements({
        modelId: context.modelId,
        organizationId: context.organizationId,
        plan: buildBimElementPlan(request.filter, {
          searchKeysIndexed: model.searchKeysIndexed,
        }),
        elementCount: model.elementCount,
        limit: request.limit,
        offset: request.offset,
      })
      return finish({
        ...modelBase,
        elements: rows,
        total,
        totalIsLowerBound,
        truncated: totalIsLowerBound || request.offset + rows.length < total,
      })
    }

    case 'element':
      return finish({
        ...modelBase,
        element: await findBimElement(context.modelId, context.organizationId, request.globalId),
      })

    case 'properties': {
      const catalog = await listBimPropertyCatalog({
        modelId: context.modelId,
        organizationId: context.organizationId,
        ifcType: request.ifcType,
        maxValues: request.maxValues,
      })
      return finish({
        ...modelBase,
        properties: catalog.entries,
        propertyScan: {
          scanned: catalog.scanned,
          total: catalog.total,
          complete: catalog.complete,
        },
      })
    }

    case 'schedule': {
      if (!model.summary) throw new BimModelNotReadyError('failed', 'Model has no summary')
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId
      )
      return finish({ ...modelBase, truncated, schedule: buildRoomSchedule(model.summary, elements) })
    }

    case 'compliance': {
      return finish({
        ...modelBase,
        ...(await complianceRun(model, context.organizationId, {
          buildingClass: request.buildingClass ?? null,
          mainUse: request.mainUse ?? null,
        })),
      })
    }

    case 'takeoff': {
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId,
        buildBimPredicate(request.filter, { searchKeysIndexed: model.searchKeysIndexed })
      )
      return finish({
        ...modelBase,
        truncated,
        takeoff: buildQuantityTakeoff(elements, {
          quantity: request.quantity,
          byMaterial: request.byMaterial,
        }),
      })
    }

    case 'compliance-diff': {
      if (!request.baseModelId) {
        throw new BimModelNotReadyError('failed', 'compliance-diff requires a base model')
      }
      const base = await findBimModelById(request.baseModelId, context.organizationId, internalRead('reloaded'))
      if (!base || base.status !== 'ready') {
        throw new BimModelNotReadyError(base?.status ?? 'failed', 'Base model is not ready')
      }
      const facts = {
        buildingClass: request.buildingClass ?? null,
        mainUse: request.mainUse ?? null,
      }
      const siteContext = await contextOfModel(model, context.organizationId)
      const [before, after] = await Promise.all([
        complianceRun(base, context.organizationId, facts, siteContext),
        complianceRun(model, context.organizationId, facts, siteContext),
      ])
      return finish({
        ...modelBase,
        compliance: after.compliance,
        complianceSummary: after.complianceSummary,
        complianceShoppingList: after.complianceShoppingList,
        complianceChanges: diffBimCompliance(before.compliance, after.compliance),
        comparedWith: base.filename,
        truncated: before.truncated || after.truncated,
      })
    }

    case 'profile': {
      if (!model.summary) throw new BimModelNotReadyError('failed', 'Model has no summary')
      const { elements, truncated } = await loadBimElementsForSchedule(
        context.modelId,
        context.organizationId
      )
      return finish({
        ...modelBase,
        truncated,
        profileSuggestions: deriveProfileSuggestions({
          summary: model.summary,
          spaceNames: elements
            .filter((element) => element.ifcType === 'IfcSpace')
            .map((element) => element.name ?? '')
            .filter(Boolean),
        }),
      })
    }

    case 'compare': {
      if (!request.baseModelId) {
        throw new BimModelNotReadyError('failed', 'No model to compare against was resolved')
      }
      const baseModel = await findBimModelById(request.baseModelId, context.organizationId, internalRead('reloaded'))
      if (!baseModel || baseModel.status !== 'ready') {
        throw new BimModelNotReadyError(
          baseModel?.status ?? 'failed',
          'The model to compare against is not ready'
        )
      }
      const [baseElements, revisionElements] = await Promise.all([
        loadBimElementsForComparison(baseModel.id, context.organizationId, request.limit),
        loadBimElementsForComparison(context.modelId, context.organizationId, request.limit),
      ])
      return finish({
        ...modelBase,
        comparison: compareModels({
          base: baseElements.elements,
          revision: revisionElements.elements,
          truncated: baseElements.truncated || revisionElements.truncated,
        }),
      })
    }

    case 'aggregate': {
      const groups = await aggregateBimElements({
        modelId: context.modelId,
        organizationId: context.organizationId,
        where: buildBimPredicate(request.filter, { searchKeysIndexed: model.searchKeysIndexed }),
        groupExpression: groupExpression(request.groupBy, request.groupProperty),
        metricExpression: metricExpression(request),
        metricValueExpression: metricValueExpression(request),
        limit: request.limit,
      })
      return finish({
        ...modelBase,
        groups,
        units: model.summary?.units,
        truncated: groups.some((group) => group.truncated),
      })
    }
  }
}

export {
  BIM_FILTER_OPERATORS,
  BIM_GROUP_BY,
  BIM_MAIN_USE,
  BIM_METRICS,
  bimFilterSchema,
  bimQuerySchema,
  canonicalBimMainUse,
  renameLegacyBimFactNames,
  type BimFilter,
  type BimFilterOperator,
  type BimGroupBy,
  type BimMainUse,
  type BimPropertyFilter,
  type BimQuery,
} from './query-schema'
export type { BimQueryResult } from './query-result'
export { buildBimElementPlan, buildBimPredicate } from './element-filter-sql'
export type { BimComplianceChange, BimComplianceSummary, BimRuleResult } from './rules'
export type { BimElementListRow, BimGroupedCount, BimPropertyCatalogEntry } from './repository'
export type { BimComparison } from './compare'
export type { BimRoomSchedule, BimQuantityRow } from './schedule'
export type { BimProfileSuggestion } from './profile'
