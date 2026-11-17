import { type FC, useCallback, useId } from 'react'
import type { AnswerCard } from '@/shared/cards/schemas'
import { cardKey } from '../card-decision'
import { ProjectProfilePatchCard } from './ProjectProfilePatchCard'
import { MemoryProposalCard } from './MemoryProposalCard'
import { OperationReceipt } from './ProposalReceipts'
import { FileOperationProposalCard } from './FileOperationProposalCard'
import { CanvasActivityCard } from './CanvasActivityCard'
import { LookCard } from './LookCard'
import { RevisionCompareCard } from './RevisionCompareCard'
import { CalculationCard } from './CalculationCard'
import { FormulaCard } from './FormulaCard'
import { BuildingSectionCard } from '../schematics/BuildingSectionCard'
import { StairDiagramCard } from '../schematics/StairDiagramCard'
import { DimensionDiagramCard } from '../schematics/DimensionDiagramCard'
import { SetbackPlanCard } from '../schematics/SetbackPlanCard'
import { EgressDiagramCard } from '../schematics/EgressDiagramCard'
import { DaylightIncidenceCard } from '../schematics/DaylightIncidenceCard'
import { GuardrailCheckCard } from '../schematics/GuardrailCheckCard'
import { FireAccessPlanCard } from '../schematics/FireAccessPlanCard'
import { DocumentAnswerCard } from './DocumentAnswerCard'
import { DocumentDraftCard } from './DocumentDraftCard'
import { TaskCreatedCard } from './TaskCreatedCard'
import { IfcViewerCard } from './IfcViewerCard'
import { IfcModelPickerCard } from './IfcModelPickerCard'
import { cardHighlightSpecs } from '@/features/bim/lib/card-highlights'
import {
  IfcComplianceCard,
  IfcDiffCard,
  IfcElementCard,
  IfcScheduleCard,
} from './IfcDataCards'
import type { SurfacedDocument } from '@/features/documents/hooks/use-surfaced-documents'
import { FadeIn } from '@/components/motion'
import { A2uiCard } from '@/features/a2ui/A2uiCard'

interface AnswerCardsProps {
  cards: (AnswerCard | undefined)[]
  projectId?: string | null
  messageId?: string
  indices?: readonly number[]
  decisionsMustPersist?: boolean
}

interface AnswerCardItemProps {
  card: AnswerCard
  index: number
  projectId?: string | null
  messageId?: string
  decisionsMustPersist?: boolean
}

interface AnswerCardViewProps extends AnswerCardItemProps {
  leafId?: string
}

export const AnswerCardView: FC<AnswerCardViewProps> = ({
  card,
  index,
  projectId,
  messageId,
  decisionsMustPersist,
  leafId,
}) => {
  const key = leafId === undefined ? cardKey(card, index) : `${cardKey(card, index)}.${leafId}`

  if (card.type === 'formula') {
    return (
      <FadeIn distance={6}>
        <FormulaCard title={card.title} formula={card.formula} note={card.note} site_binding={card.site_binding} />
      </FadeIn>
    )
  }

  if (card.type === 'calculation') {
    return (
      <FadeIn distance={6}>
        <CalculationCard
          title={card.title}
          steps={card.steps ?? []}
          limit={card.limit}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'building_section') {
    return (
      <FadeIn distance={6}>
        <BuildingSectionCard
          title={card.title}
          storeys={card.storeys ?? []}
          markers={card.markers}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'stair_diagram') {
    return (
      <FadeIn distance={6}>
        <StairDiagramCard
          title={card.title}
          riser_count={card.riser_count}
          riser_height={card.riser_height}
          tread_depth={card.tread_depth}
          width={card.width}
          comfort_note={card.comfort_note}
          reference={card.reference}
        />
      </FadeIn>
    )
  }

  if (card.type === 'dimension_diagram') {
    return (
      <FadeIn distance={6}>
        <DimensionDiagramCard
          title={card.title}
          shape={card.shape}
          dimensions={card.dimensions ?? []}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'setback_plan') {
    return (
      <FadeIn distance={6}>
        <SetbackPlanCard
          title={card.title}
          parcel_width_m={card.parcel_width_m}
          parcel_depth_m={card.parcel_depth_m}
          building_width_m={card.building_width_m}
          building_depth_m={card.building_depth_m}
          sides={card.sides ?? []}
          reference={card.reference}
          parcel_area_m2={card.parcel_area_m2}
          footprint_area_m2={card.footprint_area_m2}
          gross_floor_area_m2={card.gross_floor_area_m2}
          coverage={card.coverage}
          density={card.density}
        />
      </FadeIn>
    )
  }

  if (card.type === 'egress_diagram') {
    return (
      <FadeIn distance={6}>
        <EgressDiagramCard
          title={card.title}
          segments={card.segments ?? []}
          total_length={card.total_length}
          start_label={card.start_label}
          exit_label={card.exit_label}
          reference={card.reference}
        />
      </FadeIn>
    )
  }

  if (card.type === 'daylight_incidence') {
    return (
      <FadeIn distance={6}>
        <DaylightIncidenceCard
          title={card.title}
          room_floor_area_m2={card.room_floor_area_m2}
          glass_area={card.glass_area}
          window_sill_height_m={card.window_sill_height_m}
          window_head_height_m={card.window_head_height_m}
          obstruction={card.obstruction}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'guardrail_check') {
    return (
      <FadeIn distance={6}>
        <GuardrailCheckCard
          title={card.title}
          context={card.context}
          fall_height={card.fall_height}
          rail_height={card.rail_height}
          max_opening={card.max_opening}
          bottom_gap={card.bottom_gap}
          has_horizontal_elements_in_climb_zone={card.has_horizontal_elements_in_climb_zone}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'fire_access_plan') {
    return (
      <FadeIn distance={6}>
        <FireAccessPlanCard
          title={card.title}
          parcel_width_m={card.parcel_width_m}
          parcel_depth_m={card.parcel_depth_m}
          building_width_m={card.building_width_m}
          building_depth_m={card.building_depth_m}
          route_width={card.route_width}
          gate_clearance_height={card.gate_clearance_height}
          staging_area={card.staging_area}
          walk_distance_to_entrance={card.walk_distance_to_entrance}
          building_class={card.building_class}
          reference={card.reference}
          note={card.note}
        />
      </FadeIn>
    )
  }

  if (card.type === 'project_profile_patch') {
    return (
      <FadeIn distance={6}>
        <ProjectProfilePatchCard
          title={card.title || ''}
          rationale={card.rationale || ''}
          patch={card.patch || []}
          projectId={projectId}
          proposalId={card.proposal_id}
          messageId={messageId}
          cardKey={key}
          decisionsMustPersist={decisionsMustPersist}
        />
      </FadeIn>
    )
  }

  if (card.type === 'document_grid') {
    return (
      <FadeIn distance={6}>
        <DocumentAnswerCard
          title={card.title}
          query={card.query}
          documents={(card.documents ?? []) as SurfacedDocument[]}
          search={card.search ?? null}
          projectId={projectId}
        />
      </FadeIn>
    )
  }

  if (card.type === 'document_draft') {
    return (
      <FadeIn distance={6}>
        <DocumentDraftCard
          title={card.title}
          path={card.path}
          bytes={card.bytes}
          version={card.version}
          documentId={card.document_id}
          versionId={card.version_id}
          versionState={card.version_state}
          messageId={messageId}
          cardKey={key}
          decisionsMustPersist={decisionsMustPersist}
        />
      </FadeIn>
    )
  }

  if (card.type === 'task_created') {
    return (
      <FadeIn distance={6}>
        <TaskCreatedCard
          taskId={card.task_id}
          kind={card.kind}
          title={card.title}
          goal={card.goal}
          dueAt={card.due_at}
          conversationId={card.conversation_id}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_viewer') {
    return (
      <FadeIn distance={6}>
        <IfcViewerCard
          title={card.title}
          modelFile={card.model_file ?? null}
          storey={card.storey ?? null}
          note={card.note ?? null}
          highlights={cardHighlightSpecs(card.highlights ?? [])}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_schedule') {
    return (
      <FadeIn distance={6}>
        <IfcScheduleCard
          title={card.title}
          modelFile={card.model_file ?? null}
          storey={card.storey ?? null}
          note={card.note ?? null}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_element') {
    return (
      <FadeIn distance={6}>
        <IfcElementCard
          title={card.title}
          globalId={card.global_id}
          modelFile={card.model_file ?? null}
          note={card.note ?? null}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_diff') {
    return (
      <FadeIn distance={6}>
        <IfcDiffCard
          title={card.title}
          baseModelFile={card.base_model_file}
          modelFile={card.model_file ?? null}
          note={card.note ?? null}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_compliance') {
    return (
      <FadeIn distance={6}>
        <IfcComplianceCard
          title={card.title}
          modelFile={card.model_file ?? null}
          ruleIds={card.rule_ids ?? []}
          note={card.note ?? null}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'ifc_model_picker') {
    return (
      <FadeIn distance={6}>
        <IfcModelPickerCard
          title={card.title}
          note={card.note ?? null}
          projectId={projectId ?? null}
        />
      </FadeIn>
    )
  }

  if (card.type === 'file_operation_proposal') {
    return (
      <FadeIn distance={6}>
        <FileOperationProposalCard
          title={card.title}
          operation={card.operation}
          operations={card.operations}
          note={card.note}
          proposalId={card.proposal_id}
          messageId={messageId}
          cardKey={key}
          decisionsMustPersist={decisionsMustPersist}
        />
      </FadeIn>
    )
  }

  if (card.type === 'operation_proposal') {
    return (
      <FadeIn distance={6}>
        <OperationReceipt
          proposalId={card.proposal_id}
          title={card.title}
          operation={card.operation}
          input={card.input ?? {}}
        />
      </FadeIn>
    )
  }

  if (card.type === 'look') {
    return (
      <FadeIn distance={6}>
        <LookCard document={card.document} items={card.items} />
      </FadeIn>
    )
  }

  if (card.type === 'revision_compare') {
    return (
      <FadeIn distance={6}>
        <RevisionCompareCard
          olderId={card.older_id}
          newerId={card.newer_id}
          olderName={card.older_name}
          newerName={card.newer_name}
          page={card.page}
          changes={card.changes}
          summary={card.summary}
        />
      </FadeIn>
    )
  }

  if (card.type === 'canvas_activity') {
    return (
      <FadeIn distance={6}>
        <CanvasActivityCard
          document={card.document}
          items={card.items}
          messageId={messageId}
          cardKey={key}
          decisionsMustPersist={decisionsMustPersist}
        />
      </FadeIn>
    )
  }

  if (card.type === 'memory_proposal') {
    return (
      <FadeIn distance={6}>
        <MemoryProposalCard
          title={card.title}
          content={card.content}
          kind={card.kind}
          confidence={card.confidence}
          topic={card.topic}
          supersedes={card.supersedes}
          proposalId={card.proposal_id}
          messageId={messageId}
          cardKey={key}
          decisionsMustPersist={decisionsMustPersist}
        />
      </FadeIn>
    )
  }

  return null
}

export const AnswerCardItem: FC<AnswerCardItemProps> = ({ card, index, projectId, messageId, decisionsMustPersist }) => {
  const fallbackId = useId()
  const isSurface = card.type === 'surface'
  const render = useCallback(
    (leaf: AnswerCard, leafId: string) => (
      <AnswerCardView
        card={leaf}
        index={index}
        projectId={projectId}
        messageId={messageId}
        decisionsMustPersist={decisionsMustPersist}
        leafId={isSurface ? leafId : undefined}
      />
    ),
    [index, projectId, messageId, decisionsMustPersist, isSurface]
  )
  return <A2uiCard card={card} surfaceKey={`${messageId ?? fallbackId}:${index}`} render={render} />
}

export const AnswerCards: FC<AnswerCardsProps> = ({
  cards,
  projectId,
  messageId,
  indices,
  decisionsMustPersist,
}) => {
  const positions = indices ?? cards.map((_, index) => index)
  if (positions.length === 0) {
    return null
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {positions.map((index) => {
        const card = cards[index]
        if (!card) return null
        return (
          <AnswerCardItem
            key={cardKey(card, index)}
            card={card}
            index={index}
            projectId={projectId}
            messageId={messageId}
            decisionsMustPersist={decisionsMustPersist}
          />
        )
      })}
    </div>
  )
}
