/** Only an unmistakable name is a plan („S-101_D.pdf“): a wrong candidate costs more than a missing one. */
export interface PlanName {
  stem: string
  index: string
  extension: string
}

const PLAN_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'dwg', 'dxf', 'ifc', 'plt', 'pln', 'rvt'])

const INDEXED = /^(.*\d.*?)[_-]([a-z])$/iu

export function planName(filename: string | null | undefined): PlanName | null {
  const dot = filename?.lastIndexOf('.') ?? -1
  if (!filename || dot <= 0) return null
  const extension = filename.slice(dot + 1).toLowerCase()
  if (!PLAN_EXTENSIONS.has(extension)) return null
  const match = INDEXED.exec(filename.slice(0, dot).normalize('NFC'))
  if (!match) return null
  return { stem: match[1], index: match[2].toUpperCase(), extension }
}

export function planNamePattern(plan: PlanName): string {
  return `${plan.stem.toLowerCase().replace(/[\\%_]/gu, '\\$&')}__.${plan.extension}`
}

function samePlan(a: PlanName, b: PlanName): boolean {
  return a.extension === b.extension && a.stem.toLowerCase() === b.stem.toLowerCase()
}

export function revisionByDefault(filename: string | null | undefined, candidateName: string): boolean {
  const file = planName(filename)
  const current = planName(candidateName)
  return !!file && !!current && samePlan(file, current) && file.index >= current.index
}

export interface IndexChange {
  plan: string
  from: string
  to: string
}

export function indexChange(filename: string | null | undefined, candidateName: string): IndexChange | null {
  const file = planName(filename)
  const current = planName(candidateName)
  if (!file || !current || !samePlan(file, current) || file.index === current.index) return null
  return { plan: file.stem, from: current.index, to: file.index }
}

/** `documents` newest first: one of the same name, else the latest earlier index of the same plan. */
export function revisionCandidateOf<T extends { filename: string }>(filename: string, documents: readonly T[]): T | null {
  const namesake = documents.find((document) => document.filename === filename)
  if (namesake) return namesake
  const file = planName(filename)
  if (!file) return null
  let best: { document: T; index: string } | null = null
  for (const document of documents) {
    const plan = planName(document.filename)
    if (!plan || !samePlan(plan, file) || plan.index >= file.index) continue
    if (!best || plan.index > best.index) best = { document, index: plan.index }
  }
  return best?.document ?? null
}
