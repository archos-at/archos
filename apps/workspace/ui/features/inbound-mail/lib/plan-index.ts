export interface PlanName {
  stem: string
  index: string
  extension: string
}

const PLAN_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'dwg', 'dxf', 'ifc', 'plt', 'pln', 'rvt'])

const INDEXED = /^(.*\d.*?)[\s_.-]+(?:(?:index|idx|rev)[\s_.-]*)?([a-z])$/iu

export function planName(filename: string | null | undefined): PlanName | null {
  const dot = filename?.lastIndexOf('.') ?? -1
  if (!filename || dot <= 0) return null
  const extension = filename.slice(dot + 1).toLowerCase()
  if (!PLAN_EXTENSIONS.has(extension)) return null
  const match = INDEXED.exec(filename.slice(0, dot).normalize('NFC').trim())
  if (!match) return null
  return { stem: match[1], index: match[2].toUpperCase(), extension }
}

const stemKey = (stem: string): string => stem.toLowerCase().replace(/[\s_.-]+/gu, '_')

/** The same plan number and format with the same or a later letter index: „S-101_D.pdf“ over „S-101_C.pdf“. */
export function revisionByDefault(filename: string | null | undefined, candidateName: string): boolean {
  const file = planName(filename)
  const current = planName(candidateName)
  if (!file || !current || file.extension !== current.extension) return false
  return stemKey(file.stem) === stemKey(current.stem) && file.index >= current.index
}

export function replacedIndex(filename: string | null | undefined, candidateName: string): string | null {
  const file = planName(filename)
  const current = planName(candidateName)
  return current && file?.index !== current.index ? current.index : null
}
