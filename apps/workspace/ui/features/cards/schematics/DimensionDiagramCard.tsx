import { type FC } from 'react'
import { Ruler } from 'lucide-react'
import { DimChecksList, SchematicCanvas, SchematicCard, worstStatus } from './kit'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { DimensionCheckData, NormReferenceData } from '@/shared/cards/schemas'
import type { Template } from '../components/dimension-diagram-card/template'
import { corridorTemplate } from '../components/dimension-diagram-card/corridor-template'
import { doorTemplate } from '../components/dimension-diagram-card/door-template'
import { liftCabinTemplate } from '../components/dimension-diagram-card/lift-cabin-template'
import { parkingTemplate } from '../components/dimension-diagram-card/parking-template'
import { rampTemplate } from '../components/dimension-diagram-card/ramp-template'
import { thresholdTemplate } from '../components/dimension-diagram-card/threshold-template'
import { turningCircleTemplate } from '../components/dimension-diagram-card/turning-circle-template'

type Shape = 'door' | 'ramp' | 'corridor' | 'turning_circle' | 'threshold' | 'parking_space' | 'lift_cabin'

interface DimensionDiagramCardProps {
  title: string
  shape: Shape
  dimensions: DimensionCheckData[]
  reference?: NormReferenceData | null
  note?: string | null
}

const TEMPLATES: Record<Shape, (dims: DimensionCheckData[], t: Translator) => Template> = {
  door: doorTemplate,
  ramp: rampTemplate,
  corridor: corridorTemplate,
  turning_circle: turningCircleTemplate,
  threshold: thresholdTemplate,
  parking_space: parkingTemplate,
  lift_cabin: liftCabinTemplate,
}

export const DimensionDiagramCard: FC<DimensionDiagramCardProps> = ({
  title,
  shape,
  dimensions,
  reference,
  note,
}) => {
  const t = useTranslations(chatCopy)
  const template = (TEMPLATES[shape] ?? doorTemplate)(dimensions, t)

  return (
    <SchematicCard
      icon={Ruler}
      title={title}
      verdict={worstStatus(dimensions.map((d) => d.status))}
      note={note}
      reference={reference}
    >
      <SchematicCanvas viewW={template.viewW} viewH={template.viewH} label={title}>
        {template.node}
      </SchematicCanvas>
      <DimChecksList checks={dimensions} />
    </SchematicCard>
  )
}
