import { hasWord } from './card-numbers'
import { foldForScreening } from './name-screen'

const MARK = /\p{M}/u

const FINAL_SIGMA = /ς/g

function clusters(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let index = 0
  for (const char of text) {
    const last = out[out.length - 1]
    if (last && MARK.test(char)) last[1] = index + char.length
    else out.push([index, index + char.length])
    index += char.length
  }
  return out
}

function foldCluster(cluster: string): string {
  return foldForScreening(cluster).replace(FINAL_SIGMA, 'σ')
}

export function foldContent(text: string): string {
  return clusters(text)
    .map(([start, end]) => foldCluster(text.slice(start, end)))
    .join('')
}

export interface Folded {
  text: string
  starts: number[]
  ends: number[]
}

export function foldMapped(text: string): Folded {
  const parts: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (const [start, end] of clusters(text)) {
    const folded = foldCluster(text.slice(start, end))
    parts.push(folded)
    for (let i = 0; i < folded.length; i += 1) {
      starts.push(start)
      ends.push(end)
    }
  }
  return { text: parts.join(''), starts, ends }
}

export function pageSays(text: string, labels: readonly string[]): boolean {
  return hasWord(foldContent(text), labels)
}
