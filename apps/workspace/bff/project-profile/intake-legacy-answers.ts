import type { ProjectPrimitiveValue, ProjectProfile } from './types'
import { type BuildingInstance, answerKeyFor, modeKeyFor } from './intake-building-keys'
import { isIntakeAnswerProvided } from './intake-conditions'

const LEGACY_TECHNOLOGY_KEYS = ['pv', 'ventilation', 'cooling', 'infiltration'] as const

const LEGACY_PLANNED_WORK_TO_MEASURE: Record<string, string> = {
  refurbishment: 'envelope_refurbishment',
  conversion: 'interior_conversion',
  extension: 'extension',
  change_of_use: 'change_of_use',
  demolition: 'partial_demolition',
}

function legacyBoolean(profile: ProjectProfile, key: string): boolean | undefined {
  const value = profile.facts[key]?.value
  return typeof value === 'boolean' ? value : undefined
}

export function applyLegacyAnswerBridges(
  profile: ProjectProfile,
  answers: Record<string, ProjectPrimitiveValue>,
  buildings: BuildingInstance[]
): void {
  if (buildings.length === 1) {
    const buildingId = buildings[0].id
    const legacyExisting: Array<{ question: string; key: string; numeric: boolean }> = [
      { question: 'CB1', key: 'existing_year_built', numeric: true },
      { question: 'CB3', key: 'heritage_protection', numeric: false },
      { question: 'CB5', key: 'structural_intervention', numeric: false },
      { question: 'CB6', key: 'major_renovation', numeric: false },
    ]
    let bridgedAny = false
    for (const { question, key, numeric } of legacyExisting) {
      const answerKey = answerKeyFor(question, buildingId)
      if (answers[answerKey] !== undefined || answers[modeKeyFor(answerKey)] !== undefined) continue
      if (numeric) {
        const fact = profile.facts[key]?.value
        const assumption = profile.assumptions[key]?.value
        if (typeof fact === 'number') {
          answers[answerKey] = fact
          answers[modeKeyFor(answerKey)] = 'value'
          bridgedAny = true
        } else if (typeof assumption === 'number') {
          answers[answerKey] = assumption
          answers[modeKeyFor(answerKey)] = 'estimated'
          bridgedAny = true
        }
        continue
      }
      const bool = legacyBoolean(profile, key)
      if (bool !== undefined) {
        answers[answerKey] = bool ? 'yes' : 'no'
        bridgedAny = true
      } else if (profile.unknowns.includes(key)) {
        answers[answerKey] = 'open'
        bridgedAny = true
      }
    }
    const c2Key = answerKeyFor('C2', buildingId)
    if (bridgedAny && answers[c2Key] === undefined) answers[c2Key] = 'existing'

    const cb4Key = answerKeyFor('CB4', buildingId)
    const cb6Key = answerKeyFor('CB6', buildingId)
    if (answers[cb6Key] !== undefined && !isIntakeAnswerProvided(answers[cb4Key])) {
      const plannedWork = profile.facts['work_type']?.value
      const measures = new Set<string>()
      if (Array.isArray(plannedWork)) {
        for (const workType of plannedWork) {
          const mapped = LEGACY_PLANNED_WORK_TO_MEASURE[String(workType)]
          if (mapped) measures.add(mapped)
        }
      }
      if (measures.size === 0) measures.add('envelope_refurbishment')
      answers[cb4Key] = [...measures]
    }
  }

  for (const building of buildings) {
    const c8Key = answerKeyFor('C8', building.id)
    if (answers[c8Key] === undefined) {
      const legacy = profile.facts[`units_under_400@${building.id}`]?.value
      if (typeof legacy === 'boolean') answers[c8Key] = legacy ? 'no' : 'yes'
      else if (profile.unknowns.includes(`units_under_400@${building.id}`)) answers[c8Key] = 'open'
    }

    const c10Key = answerKeyFor('C10', building.id)
    const c10 = answers[c10Key]
    if (typeof c10 === 'string') {
      const mapped: Record<string, string[]> = {
        massivbau: ['masonry_solid'],
        timber: ['timber'],
        stahl: ['steel'],
        open: ['open'],
      }
      const replacement = mapped[c10]
      if (replacement) {
        answers[c10Key] = replacement
      } else if (c10 === 'hybrid') {
        answers[c10Key] = ['open']
        const c10TextKey = answerKeyFor('C10_text', building.id)
        if (!isIntakeAnswerProvided(answers[c10TextKey])) {
          answers[c10TextKey] =
            'Hybridbauweise (aus früherer Angabe — Kombination bitte präzisieren)'
        }
      } else {
        delete answers[c10Key]
      }
    }

    const e2Key = answerKeyFor('E2', building.id)
    if (answers[e2Key] === undefined) {
      const technology: string[] = []
      if (legacyBoolean(profile, `pv@${building.id}`)) technology.push('pv')
      if (legacyBoolean(profile, `ventilation@${building.id}`)) technology.push('ventilation')
      if (legacyBoolean(profile, `cooling@${building.id}`)) technology.push('cooling')
      if (legacyBoolean(profile, `infiltration@${building.id}`)) technology.push('infiltration')
      if (technology.length > 0) answers[e2Key] = technology
      else if (
        LEGACY_TECHNOLOGY_KEYS.every((key) => legacyBoolean(profile, `${key}@${building.id}`) === false)
      ) {
        answers[e2Key] = ['none']
      }
    }
  }

  const b4Additions: string[] = []
  if (legacyBoolean(profile, 'contaminated_land')) b4Additions.push('contaminated_land')
  if (legacyBoolean(profile, 'tree_stock')) b4Additions.push('tree_stock')
  if (legacyBoolean(profile, 'protected_area')) b4Additions.push('protected_area')
  if (b4Additions.length > 0) {
    const current = Array.isArray(answers['B4']) ? (answers['B4'] as string[]) : []
    const merged = [
      ...current.filter((value) => value !== 'none'),
      ...b4Additions.filter((v) => !current.includes(v)),
    ]
    answers['B4'] = merged
  }

  if (answers['B6'] === undefined) {
    const sewer = legacyBoolean(profile, 'sewer')
    const water = legacyBoolean(profile, 'drinking_water')
    const access = legacyBoolean(profile, 'fire_brigade_access')
    if (sewer !== undefined && water !== undefined && access !== undefined) {
      const yes = [sewer, water, access].filter(Boolean).length
      if (yes === 0) answers['B6'] = 'no'
      else if (yes < 3) answers['B6'] = 'partial'
    }
  }

  if (answers['B7'] === undefined) {
    if (legacyBoolean(profile, 'district_heating_zone')) answers['B7'] = 'connection_area'
    else {
      const fw = legacyBoolean(profile, 'district_heating')
      if (fw !== undefined) answers['B7'] = fw ? 'available' : 'unavailable'
    }
  }

  const zert = profile.facts['certification']?.value
  if (typeof zert === 'string' && !['none', 'open'].includes(zert)) {
    const current = Array.isArray(answers['F4']) ? (answers['F4'] as string[]) : []
    if (!current.includes(zert))
      answers['F4'] = [...current.filter((value) => value !== 'none'), zert]
  }

  const appendText = (answerKey: string, key: string) => {
    const legacy = profile.facts[key]?.value
    if (typeof legacy !== 'string' || !legacy.trim()) return
    const current = answers[answerKey]
    if (typeof current !== 'string' || !current.trim()) {
      answers[answerKey] = legacy
      return
    }
    if (current.includes(legacy.trim())) return
    answers[answerKey] = `${current}\n\n${legacy}`
  }
  appendText('G1', 'context_plot')
  appendText('G4', 'context_other')
}
