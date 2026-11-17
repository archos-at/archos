const REVISION_MARKERS: RegExp[] = [
  /[ _-]?(v|ver|rev|revision|version|stand|st)[ _.-]?\d+(\.\d+)*$/i,
  /[ _-]?\(\d+\)$/,
  /[ _-]\d{4}[-_]?\d{2}[-_]?\d{2}$/,
  /[ _-]\d{8}t?\d{4,6}$/i,
]

const TRAILING_SEPARATORS = /[ _.-]+$/

export function revisionSeriesKey(filename: string): string {
  let base = filename.replace(/\.(ifc|ifczip)$/i, '')
  for (let pass = 0; pass < 4; pass += 1) {
    const before = base
    for (const marker of REVISION_MARKERS) {
      base = base.replace(marker, '')
    }
    base = base.replace(TRAILING_SEPARATORS, '')
    if (base === before) break
  }
  const trimmed = base.trim()
  return (trimmed.length > 0 ? trimmed : filename).toLowerCase()
}
