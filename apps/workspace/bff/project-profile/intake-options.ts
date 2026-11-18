import type { ProjectIntakeOption } from './intake-types'

export const USES: ProjectIntakeOption[] = [
  { value: 'residential', label: 'Wohnen' },
  { value: 'office', label: 'Büro / Verwaltung' },
  { value: 'retail', label: 'Handel / Verkauf' },
  { value: 'catering', label: 'Gastronomie' },
  { value: 'lodging', label: 'Beherbergung' },
  { value: 'assembly', label: 'Versammlung / Veranstaltung' },
  { value: 'education', label: 'Bildung / Betreuung' },
  { value: 'healthcare', label: 'Gesundheit / Pflege' },
  { value: 'production', label: 'Produktion / Gewerbe / Lager' },
  { value: 'garage', label: 'Garage / Stellplätze' },
  { value: 'agriculture', label: 'Landwirtschaft' },
  { value: 'technical', label: 'Technik / Sonstiges' },
]

export const FOUND_IN = {
  titleBlock: 'Einreichplan (Plankopf)',
  siteLayout: 'Lageplan',
  submissionSiteLayout: 'Einreichplan (Lageplan)',
  floorLayout: 'Einreichplan (Grundriss)',
  section: 'Einreichplan (Schnitt)',
  elevation: 'Einreichplan (Ansicht)',
  buildingDescription: 'Baubeschreibung',
  permit: 'Bescheid',
  landRegister: 'Grundbuchauszug',
  zoning: 'Flächenwidmungsplan',
  developmentPlan: 'Bebauungsplan (Plandokument)',
  energyCertificate: 'Energieausweis',
  fireSafety: 'Brandschutzkonzept',
  structural: 'Statik',
  hazardZonePlan: 'Gefahrenzonenplan',
  contaminatedSites: 'Altlasten-Auskunft (Verdachtsflächenkataster)',
  noise: 'Lärmgutachten',
  heritageList: 'Denkmalliste (Bundesdenkmalamt)',
} as const
