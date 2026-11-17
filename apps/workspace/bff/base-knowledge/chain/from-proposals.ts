import { sourceRefsOf } from './source-refs'
import { recordIdOf } from '../platform/records'
import type { ProposedRecord } from '../platform/wire'
import type { GraphEdition, GraphOwner, GraphRelation, GraphTerritory, GraphWork, KnowledgeGraph } from './graph'

export function graphFromProposals(records: readonly ProposedRecord[], owner: GraphOwner = 'platform'): KnowledgeGraph {
  const territories = new Map<string, GraphTerritory>()
  const works = new Map<string, GraphWork>()
  const editions = new Map<string, GraphEdition>()
  const relations: GraphRelation[] = []
  const corpusFiles = new Map<string, string[]>()
  const sourceUrls = new Map<string, string>()
  const texts = new Map<string, { language: string; status: 'authentic' }>()
  for (const record of records) {
    if (record.type !== 'manifestation') continue
    const id = `edition:${record.editionKey}`
    if (record.corpusFile) corpusFiles.set(id, [...(corpusFiles.get(id) ?? []), record.corpusFile])
    const url = record.citations?.[0]?.url
    if (url && !sourceUrls.has(id)) sourceUrls.set(id, url)
    if (!texts.has(id)) texts.set(id, { language: record.language, status: 'authentic' })
  }
  for (const record of records) {
    const id = recordIdOf(record)
    switch (record.type) {
      case 'territory':
        territories.set(id, {
          id,
          kind: record.kind,
          name: record.name,
          parents: record.parents,
          validFrom: record.validFrom,
          validTo: record.validTo,
          coverageLevel: record.coverageLevel,
          municipalLaw: record.municipalLaw,
        })
        break
      case 'work':
        works.set(id, {
          id,
          owner,
          kind: record.kind,
          title: record.title,
          designation: record.designation,
          issuer: record.issuer,
          territoryIds: record.territoryIds,
          addresseeTerritoryIds: record.addressees.map((addressee) => addressee.territoryId),
          connectsBy: record.connectsBy,
          sourceRefs: sourceRefsOf(record.identifiers),
          historyAvailableFrom: record.historyAvailableFrom,
        })
        break
      case 'edition':
        editions.set(id, {
          id,
          owner,
          workId: `work:${record.workKey}`,
          label: record.label,
          issuedOn: record.issuedOn,
          inForceFrom: record.inForceFrom,
          inForceTo: record.inForceTo,
          corpusFiles: corpusFiles.get(id) ?? [],
          sourceUrl: sourceUrls.get(id) ?? null,
          text: texts.get(id) ?? null,
          appliesWhen: record.appliesWhen,
        })
        break
      case 'relation':
        relations.push({
          id,
          owner,
          relationType: record.relationType,
          mode: record.mode,
          fromId: `${record.from.type}:${record.from.key}`,
          fromType: record.from.type,
          toId: `${record.to.type}:${record.to.key}`,
          toType: record.to.type,
          anchors: record.anchors,
          provision: record.provision,
          validFrom: record.validFrom,
          validTo: record.validTo,
        })
        break
      default:
        break
    }
  }
  return { territories, works, editions, relations }
}

export function mergeGraphs(...graphs: readonly KnowledgeGraph[]): KnowledgeGraph {
  return {
    territories: new Map(graphs.flatMap((graph) => [...graph.territories])),
    works: new Map(graphs.flatMap((graph) => [...graph.works])),
    editions: new Map(graphs.flatMap((graph) => [...graph.editions])),
    relations: graphs.flatMap((graph) => graph.relations),
  }
}
