/**
 * A knowledge graph from proposed records, as a pack file or a change request
 * holds them (ADR-0168). Pure: the "paper" fixtures of design §9 and the
 * pack files' own checks resolve through the same resolver the turn uses,
 * without a database. Record ids are the ones a publish gives them
 * (`./platform/records.ts`).
 */

import { sourceRefsOf } from './source-refs'
import { recordIdOf } from '../platform/records'
import type { ProposedRecord } from '../platform/wire'
import type { GraphEdition, GraphOwner, GraphRelation, GraphTerritory, GraphWork, KnowledgeGraph } from './graph'

/** One graph of every record given, each owned by `owner` (the platform, unless a fixture says otherwise). */
export function graphFromProposals(records: readonly ProposedRecord[], owner: GraphOwner = 'platform'): KnowledgeGraph {
  const territories = new Map<string, GraphTerritory>()
  const works = new Map<string, GraphWork>()
  const editions = new Map<string, GraphEdition>()
  const relations: GraphRelation[] = []
  const corpusFiles = new Map<string, string[]>()
  for (const record of records) {
    if (record.type !== 'manifestation' || !record.corpusFile) continue
    const id = `edition:${record.editionKey}`
    corpusFiles.set(id, [...(corpusFiles.get(id) ?? []), record.corpusFile])
  }
  for (const record of records) {
    const id = recordIdOf(record)
    switch (record.type) {
      case 'territory':
        territories.set(id, {
          id,
          kind: record.kind,
          name: record.name,
          parentIds: record.parentIds,
          datedParents: record.datedParents,
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
          territoryIds: record.territoryIds,
          addresseeTerritoryIds: record.addressees.map((addressee) => addressee.territoryId),
          connectsBy: record.connectsBy,
          sourceRefs: sourceRefsOf(record.identifiers),
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

/** Two graphs as one: an office's records over the platform's (another office's never meet here). */
export function mergeGraphs(...graphs: readonly KnowledgeGraph[]): KnowledgeGraph {
  return {
    territories: new Map(graphs.flatMap((graph) => [...graph.territories])),
    works: new Map(graphs.flatMap((graph) => [...graph.works])),
    editions: new Map(graphs.flatMap((graph) => [...graph.editions])),
    relations: graphs.flatMap((graph) => graph.relations),
  }
}
