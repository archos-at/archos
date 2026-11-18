import type { CSSProperties } from 'react'

export type SourceSignal = 'law' | 'project' | 'office'

export function sourceTint(signal: SourceSignal): CSSProperties {
  return {
    backgroundColor: `var(--source-${signal}-tint)`,
    color: `var(--source-${signal}-text)`,
  }
}

export function sourceBase(signal: SourceSignal): string {
  return `var(--source-${signal})`
}
