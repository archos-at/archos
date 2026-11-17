const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const

export function sniffDelimiter(sample: string): string {
  const lines = sample.split('\n').slice(0, 20).filter((line) => line.trim() !== '')
  if (lines.length === 0) return ','

  let best = ','
  let bestScore = -1
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter))
    const total = counts.reduce((sum, n) => sum + n, 0)
    if (total === 0) continue
    const mean = total / counts.length
    const variance = counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length
    const score = mean / (1 + variance)
    if (score > bestScore) {
      bestScore = score
      best = delimiter
    }
  }
  return best
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') i += 1
      else inQuotes = !inQuotes
    } else if (char === delimiter && !inQuotes) {
      count += 1
    }
  }
  return count
}

export function parseDelimited(
  input: string,
  { delimiter, maxRows = 500 }: { delimiter?: string; maxRows?: number } = {}
): { rows: string[][]; delimiter: string; truncated: boolean } {
  const text = input.replace(/^\uFEFF/, '')
  const sep = delimiter ?? sniffDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let truncated = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === sep) {
      endField()
    } else if (char === '\n') {
      endRow()
      if (rows.length >= maxRows) {
        truncated = true
        break
      }
    } else if (char !== '\r') {
      field += char
    }
  }

  if (!truncated && (field !== '' || row.length > 0)) endRow()

  return { rows, delimiter: sep, truncated }
}
