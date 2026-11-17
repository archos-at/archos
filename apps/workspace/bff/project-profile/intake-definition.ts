import { PROJECT_BASIS_STAGE } from './intake-stages/project-basis'
import { PLOT_STAGE } from './intake-stages/plot'
import { BUILDINGS_STAGE } from './intake-stages/buildings'
import { USES_STAGE } from './intake-stages/uses'
import { TECHNOLOGY_STAGE } from './intake-stages/technology'
import { PROCEDURE_STAGE } from './intake-stages/procedure'
import { CONTEXT_STAGE } from './intake-stages/context'
import type { ProjectIntakeDefinition } from './intake-types'
import { PRODUCT_NAME } from '@/lib/brand'

export const projectIntakeDefinitionV1: ProjectIntakeDefinition = {
  version: 5,
  stages: [
    PROJECT_BASIS_STAGE,
    PLOT_STAGE,
    BUILDINGS_STAGE,
    USES_STAGE,
    TECHNOLOGY_STAGE,
    PROCEDURE_STAGE,
    CONTEXT_STAGE,
    {
      id: 'I',
      title: 'Projektgrundlagen',
      scope: 'project',
      description:
        'Alles, was schon existiert. ' + PRODUCT_NAME + ' nutzt diese Unterlagen als Grundlage für jede Antwort zu diesem Projekt — und sagt Ihnen, was noch fehlt.',
      questions: [],
    },
    {
      id: 'H',
      title: 'Zusammenfassung',
      scope: 'project',
      description:
        'Ihre Angaben im Überblick. Prüfen Sie alles, bevor das Projektprofil an ' + PRODUCT_NAME + ' übergeben wird.',
      questions: [],
    },
  ],
}
