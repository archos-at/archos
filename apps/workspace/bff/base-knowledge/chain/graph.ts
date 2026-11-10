/**
 * The knowledge graph a turn resolves (ADR-0168, design §3.4 and §3.5): the
 * released territories, works, editions and relations an office may read, as
 * plain values. Pure; `./load.ts` reads it from the records, a spec writes it
 * by hand ("paper" fixtures).
 */

import type { BindingMode, EditionRole, KnowledgeWorkKind, RelationEndType, RelationType, TerritoryKind } from '../wire/vocab'

/** Who owns a record: the platform, or the office reading it. Another office's records are never in a graph. */
export type GraphOwner = 'platform' | 'office'

export interface GraphTerritory {
  id: string
  kind: TerritoryKind
  name: string
  /** Undated parents, nearest first. */
  parentIds: readonly string[]
  /** Parents for an interval only, half-open: `AT` lies in `EU` from 1995-01-01. */
  datedParents: readonly { id: string; validFrom?: string | null; validTo?: string | null }[]
  validFrom: string | null
  validTo: string | null
}

export interface GraphWork {
  id: string
  owner: GraphOwner
  kind: KnowledgeWorkKind
  title: string
  designation: string | null
  /** Where it applies; empty for a standards body's work. */
  territoryIds: readonly string[]
  /** A directive's addressees, by the territory each decides for. */
  addresseeTerritoryIds: readonly string[]
}

export interface GraphEdition {
  id: string
  owner: GraphOwner
  workId: string
  label: string
  issuedOn: string | null
  inForceFrom: string | null
  inForceTo: string | null
  /** The base-corpus files that hold its text: how a retrieved passage finds its edition. */
  corpusFiles: readonly string[]
}

export interface RelationAnchorPair {
  from?: string
  to?: string
}

export interface GraphRelation {
  id: string
  owner: GraphOwner
  relationType: RelationType
  mode: BindingMode | null
  fromId: string
  fromType: RelationEndType
  toId: string
  toType: RelationEndType
  anchors: readonly RelationAnchorPair[]
  provision: string | null
  validFrom: string | null
  validTo: string | null
}

export interface KnowledgeGraph {
  territories: ReadonlyMap<string, GraphTerritory>
  works: ReadonlyMap<string, GraphWork>
  editions: ReadonlyMap<string, GraphEdition>
  relations: readonly GraphRelation[]
}

/** A clause one instrument displaces in another, with what replaces it. */
export interface Displacement {
  /** The clause displaced, an AKN eId of the target; absent when the whole target is. */
  anchor: string | null
  /** The clause that replaces it; absent when the Land only excludes it. */
  replacedBy: string | null
  /** The instrument that displaces it. */
  byWorkId: string
  provision: string | null
}

/** One step of the route that gives an edition its role. */
export interface RouteStep {
  /** `territory` for law in its territory, else the relation it follows. */
  via: 'territory' | 'relation'
  workId: string
  /** The relation followed, for a `relation` step. */
  relationId?: string
  provision?: string | null
  mode?: BindingMode | null
  owner: GraphOwner
}

/** What an edition is to this site on this date, and why (design §5.5 `EditionUse`). */
export interface EditionUse {
  workId: string
  /** Null for law held live at its source (RIS): the consolidated text in force today. */
  editionId: string | null
  role: EditionRole
  /** `office_maintained` when the route passes an office's own relation. */
  qualifier: 'office_maintained' | null
  route: readonly RouteStep[]
  displaced: readonly Displacement[]
  /** For a norm that guides here, the edition that binds where one does; for a commentary, the edition it interprets. */
  relatedEditionId: string | null
}

export interface ResolvedChain {
  date: string
  /** The site's leaf first, then every territory it lies in at the date. */
  chain: readonly string[]
  uses: readonly EditionUse[]
}
