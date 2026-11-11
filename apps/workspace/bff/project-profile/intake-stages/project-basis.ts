/** Stage A, Projektbasis: master data, location and the kind of project. */

import subdivisions from './site-subdivisions.json'
import { FOUND_IN } from '../intake-options'
import type { ProjectIntakeOption, ProjectIntakeStage } from '../intake-types'

/** The countries A2_country offers. */
const COUNTRY_OPTIONS: ProjectIntakeOption[] = [
  { value: 'at', label: 'Österreich (AT)' },
  { value: 'de', label: 'Deutschland (DE)' },
  { value: 'ch', label: 'Schweiz (CH)' },
  { value: 'other', label: 'Anderes Land' },
]

/**
 * The subdivisions a site picker offers: the country token they belong to,
 * each subdivision's token, name and territory, and the token that places a
 * site outside. The one list the create form, the contradiction check and the
 * platform's reviewer read.
 *
 * Still a table in code, and Austria's: the wizard's `federal_state` question
 * and the create form are static questionnaire definitions, offered before any
 * record is read. The records decide everything that follows from the answer
 * (the chain, the class, the register); `setup-facts.spec.ts` holds this list
 * to the `fact_definitions` of Austria (`at-setup.json`) so the two cannot
 * drift. Deferred: a picker that offers the subdivisions of the site's country
 * from its released record, which deletes this.
 */
export const SITE_SUBDIVISIONS = subdivisions as {
  country: string
  label: string
  options: readonly { token: string; label: string; territoryId: string }[]
  outside: string
}

const AUSTRIA = {
  label: SITE_SUBDIVISIONS.label,
  country: SITE_SUBDIVISIONS.country,
  options: [
    ...SITE_SUBDIVISIONS.options.map((option): ProjectIntakeOption => ({ value: option.token, label: option.label })),
    { value: SITE_SUBDIVISIONS.outside, label: 'Außerhalb Österreichs' },
  ],
}

export const PROJECT_BASIS_STAGE: ProjectIntakeStage = {
  id: 'A',
  title: 'Projektbasis',
  scope: 'project',
  description: 'Stammdaten, Standort und Art des Vorhabens.',
  questions: [
    {
      id: 'A1',
      core: true,
      label: 'Projektname',
      type: 'text',
      required: true,
      placeholder: 'z. B. WHA Quellenstraße',
      writesTo: '/facts/project_name/value',
      foundIn: [FOUND_IN.titleBlock, FOUND_IN.buildingDescription, FOUND_IN.permit],
    },
    {
      id: 'A2_adr',
      core: true,
      label: 'Adresse / Gemeinde',
      type: 'text',
      required: true,
      placeholder: 'Straße, PLZ Ort',
      why: 'Aus der Gemeinde folgen örtliche Vorschriften wie Fernwärme-Anschlussgebiete oder Schutzzonen.',
      writesTo: '/facts/site_address/value',
      foundIn: [FOUND_IN.titleBlock, FOUND_IN.submissionSiteLayout, FOUND_IN.landRegister, FOUND_IN.permit],
    },
    // Spec id A2_staat with AT/DE only. Kept as the shipped superset: the
    // storage key `country` and its token set are load-bearing (mirrored by
    // the backend jurisdiction pipeline), and CH/other already exist in
    // stored projects. The German federal state list rides with the German
    // question catalog (v2, per README Länder-Scope) — until then non-AT
    // locations describe themselves in `site_details`.
    {
      id: 'A2_country',
      core: true,
      label: 'Land',
      type: 'single_select',
      required: true,
      help: 'In welchem Land befindet sich das Bauvorhaben?',
      why: 'Über den Standort stellt das System zusammen, welche Rechtstexte und Richtlinien für dieses Projekt gelten. Für Deutschland werden Fragebogen und Regelwerks-Layer noch angepasst.',
      options: COUNTRY_OPTIONS,
      writesTo: '/facts/country/value',
      foundIn: [FOUND_IN.titleBlock, FOUND_IN.buildingDescription],
    },
    {
      id: 'A2_land',
      core: true,
      label: AUSTRIA.label,
      type: 'single_select',
      required: true,
      // Asked unless another country was chosen: a reading that finds
      // „Bundesland: Wien“ before any document names the country must still be
      // asked for it. Answering it derives `country`. Germany's and
      // Switzerland's subdivisions arrive with their records (ADR-0169); until
      // then a site there describes itself in `site_details`.
      conditions: [
        {
          param: 'A2_country',
          op: 'excludes_any',
          value: COUNTRY_OPTIONS.map((option) => option.value).filter((value) => value !== AUSTRIA.country),
        },
      ],
      why: 'Bestimmt, welche landesspezifischen Rechtstexte für den Standort herangezogen werden.',
      options: AUSTRIA.options,
      writesTo: '/facts/federal_state/value',
      foundIn: [FOUND_IN.titleBlock, FOUND_IN.permit, FOUND_IN.buildingDescription],
    },
    {
      id: 'site_details',
      label: 'Land & Region',
      help: 'Land und Region/Stadt, z. B. „Bayern, Deutschland" — für die Einordnung des anwendbaren Rechts.',
      type: 'text',
      conditions: [{ param: 'A2_country', op: 'includes_any', value: ['de', 'ch', 'other'] }],
      writesTo: '/facts/site_details/value',
    },
    {
      id: 'A4',
      core: true,
      label: 'Aktuelle Projektphase',
      type: 'single_select',
      why: 'Steuert die Erwartung an die Antwortgüte und das Phasen-Nudging: in frühen Phasen werden Schätzwerte aktiv angeboten, vor der Einreichung an offene Schätzungen erinnert.',
      options: [
        { value: 'basic_evaluation', label: 'Grundlagenermittlung' },
        { value: 'preliminary_design', label: 'Vorentwurf' },
        { value: 'design', label: 'Entwurf' },
        { value: 'submission_planning', label: 'Einreichplanung' },
        { value: 'execution_planning', label: 'Ausführungsplanung' },
        { value: 'tendering', label: 'Ausschreibung & Vergabe' },
        { value: 'construction', label: 'Ausführung' },
        { value: 'completion_handover', label: 'Fertigstellung & Übergabe' },
        { value: 'existing_operation', label: 'Bestand & Betrieb' },
      ],
      writesTo: '/facts/project_phase/value',
      foundIn: [FOUND_IN.titleBlock, FOUND_IN.buildingDescription, FOUND_IN.permit],
    },
    {
      id: 'A5',
      core: true,
      label: 'Art des Vorhabens (Projekt gesamt)',
      type: 'multi_select',
      required: true,
      why: 'Steuert, welche Fragen und Themen für dieses Projekt überhaupt relevant sind.',
      options: [
        { value: 'new_build', label: 'Neubau' },
        { value: 'extension', label: 'Zubau' },
        { value: 'conversion', label: 'Umbau' },
        { value: 'refurbishment', label: 'Sanierung' },
        { value: 'change_of_use', label: 'Nutzungsänderung' },
        { value: 'demolition', label: 'Abbruch' },
        { value: 'external_works', label: 'Außenanlagen' },
      ],
      writesTo: '/facts/work_type/value',
      foundIn: [FOUND_IN.buildingDescription, FOUND_IN.permit, FOUND_IN.titleBlock],
    },
  ],
}
