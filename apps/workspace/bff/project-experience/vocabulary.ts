import type { FingerprintKey } from '@/lib/cross-project/fingerprint'
import { UNDECIDED } from '@/lib/cross-project/similarity'
import { flattenIntakeQuestions } from '@/lib/project-profile/intake-conditions'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ExperienceVocabulary, ExperienceVocabularyEntry } from './types'

export const OIB_EDITIONS = ['2007', '2011', '2015', '2019', '2023', '2025'] as const

const BUILDING_CLASSES = ['1', '2', '3', '4', '5'] as const

function intakeEntry(key: Exclude<FingerprintKey, 'building_class'>): ExperienceVocabularyEntry {
  const writesTo = `/facts/${key}/value`
  const question = flattenIntakeQuestions(projectIntakeDefinitionV1).find((item) => item.writesTo === writesTo)
  if (!question?.options?.length) throw new Error(`The intake definition has no options for ${writesTo}`)
  return {
    multiple: question.type === 'multi_select',
    options: question.options
      .filter((option) => option.value !== UNDECIDED)
      .map((option) => ({ token: option.value, label: option.label })),
  }
}

export function experienceVocabulary(): ExperienceVocabulary {
  return {
    federal_state: intakeEntry('federal_state'),
    building_class: {
      multiple: false,
      options: BUILDING_CLASSES.map((grade) => ({ token: grade, label: `GK ${grade}` })),
    },
    construction_method: intakeEntry('construction_method'),
    uses: intakeEntry('uses'),
    work_type: intakeEntry('work_type'),
    oib_edition: {
      multiple: false,
      options: OIB_EDITIONS.map((year) => ({ token: year, label: `OIB-Richtlinien ${year}` })),
    },
  }
}
