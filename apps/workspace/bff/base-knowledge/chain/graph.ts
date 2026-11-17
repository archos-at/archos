import type { Applicability } from '../rulesets/applicability'
import type { AppliesWhenTable } from '../wire/applies-when'
import type { SourceRef } from './source-refs'
import type { TerritoryParent } from './territory-chain'
import type { BindingMode, ConnectingFactor, CoverageLevel, EditionRole, KnowledgeWorkKind, RelationEndType, RelationType, TerritoryKind, TextStatus } from '../wire/vocab'

export type GraphOwner = 'platform' | 'office'

export interface GraphTerritory {
  id: string
  kind: TerritoryKind
  name: string
  parents: readonly TerritoryParent[]
  validFrom: string | null
  validTo: string | null
  coverageLevel?: CoverageLevel | null
  municipalLaw?: boolean | null
}

export interface GraphWork {
  id: string
  owner: GraphOwner
  kind: KnowledgeWorkKind
  title: string
  designation: string | null
  issuer?: string | null
  territoryIds: readonly string[]
  addresseeTerritoryIds: readonly string[]
  connectsBy?: readonly ConnectingFactor[]
  sourceRefs?: readonly SourceRef[]
  historyAvailableFrom?: string | null
}

export interface GraphEdition {
  id: string
  owner: GraphOwner
  workId: string
  label: string
  issuedOn: string | null
  inForceFrom: string | null
  inForceTo: string | null
  corpusFiles: readonly string[]
  lastCheck?: { checkedAt: string; result: string } | null
  appliesWhen?: AppliesWhenTable | null
  sourceUrl?: string | null
  text?: { language: string; status: TextStatus } | null
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

export interface Displacement {
  anchor: string | null
  replacedBy: string | null
  byWorkId: string
  provision: string | null
}

export interface RouteStep {
  via: 'territory' | 'relation'
  workId: string
  editionId?: string | null
  relationId?: string
  provision?: string | null
  mode?: BindingMode | null
  owner: GraphOwner
}

export interface EditionUse {
  workId: string
  editionId: string | null
  role: EditionRole
  qualifier: 'office_maintained' | null
  route: readonly RouteStep[]
  displaced: readonly Displacement[]
  relatedEditionId: string | null
  applicability: Applicability | null
}

export interface UndeterminedLaw {
  workId: string
  reason: 'history_not_held' | 'edition_dates_unknown' | 'ambiguous_editions'
}

export interface ResolvedChain {
  date: string
  chain: readonly string[]
  uses: readonly EditionUse[]
  undetermined: readonly UndeterminedLaw[]
}
