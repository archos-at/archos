/**
 * The knowledge graph a turn resolves (ADR-0168, design §3.4 and §3.5): the
 * released territories, works, editions and relations an office may read, as
 * plain values. Pure; `./load.ts` reads it from the records, a spec writes it
 * by hand ("paper" fixtures).
 */

import type { Applicability } from '../rulesets/applicability'
import type { AppliesWhenTable } from '../wire/applies-when'
import type { SourceRef } from './source-refs'
import type { TerritoryParent } from './territory-chain'
import type { BindingMode, ConnectingFactor, CoverageLevel, EditionRole, KnowledgeWorkKind, RelationEndType, RelationType, TerritoryKind, TextStatus } from '../wire/vocab'

/** Who owns a record: the platform, or the office reading it. Another office's records are never in a graph. */
export type GraphOwner = 'platform' | 'office'

export interface GraphTerritory {
  id: string
  kind: TerritoryKind
  name: string
  /** Every parent, nearest first; one for an interval only states it, half-open: `AT` lies in `EU` from 1995-01-01. */
  parents: readonly TerritoryParent[]
  validFrom: string | null
  validTo: string | null
  /** How far the records go here (0213); absent or null inherits from the parent. */
  coverageLevel?: CoverageLevel | null
  /** Whether the node's own municipal law is held (0213); stated with its coverage. */
  municipalLaw?: boolean | null
}

export interface GraphWork {
  id: string
  owner: GraphOwner
  kind: KnowledgeWorkKind
  title: string
  designation: string | null
  /** Who issues it, as its record names it; absent or null when the record states none. */
  issuer?: string | null
  /** Where it applies; empty for a standards body's work. */
  territoryIds: readonly string[]
  /** A directive's addressees, by the territory each decides for. */
  addresseeTerritoryIds: readonly string[]
  /** What it attaches to (0213); absent reads as the site. */
  connectsBy?: readonly ConnectingFactor[]
  /** Its identifiers at its source, by the scheme its source record declares (`eli`, a law number): how a passage read live finds it; absent reads as none. */
  sourceRefs?: readonly SourceRef[]
  /** The first day whose edition is held (0206); absent or null: no earlier than the oldest edition present. */
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
  /** The base-corpus files that hold its text: how a retrieved passage finds its edition. */
  corpusFiles: readonly string[]
  /** The platform's newest check of it (0202 `knowledge_checks`), for freshness; absent when nobody read it. */
  lastCheck?: { checkedAt: string; result: string } | null
  /** Its scope: which buildings it is written for (0221, ADR-0178); absent or null, every building. */
  appliesWhen?: AppliesWhenTable | null
  /** Where a person opens its text: the page its platform manifestation cites first; absent when none cites one. */
  sourceUrl?: string | null
  /** The platform manifestation that holds its text: its language (BCP 47) and what that text is (authentic, a translation); absent when none is held. */
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
  /** For a `relation` step, the edition of the declaring instrument the route came through; null for law read live at its source. */
  editionId?: string | null
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
  /** Whether the edition applies to the project's buildings (ADR-0178); null where it states no scope or no building scope was given. */
  applicability: Applicability | null
}

/** A law on the chain whose edition at the date the records cannot name: it binds no edition, and says why. */
export interface UndeterminedLaw {
  workId: string
  reason: 'history_not_held' | 'edition_dates_unknown' | 'ambiguous_editions'
}

export interface ResolvedChain {
  date: string
  /** The site's leaf first, then every territory it lies in at the date. */
  chain: readonly string[]
  uses: readonly EditionUse[]
  /** Law on the chain left out because its edition at the date is unknown, never guessed (`time/editions.ts`). */
  undetermined: readonly UndeterminedLaw[]
}
