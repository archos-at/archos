import type { Lifecycle } from './define-lifecycle'

/**
 * A lifecycle as a Mermaid `stateDiagram-v2`, which GitHub and the docs site
 * draw from the text. Moves that share a source and a target share an arrow.
 */
export function lifecycleDiagram(lifecycle: Lifecycle<string, string>): string {
  const lines = ['stateDiagram-v2']
  for (const state of lifecycle.birthStates) lines.push(`  [*] --> ${state}`)
  const arrows = new Map<string, string[]>()
  for (const move of lifecycle.moves) {
    const key = `${move.from} --> ${move.to}`
    arrows.set(key, [...(arrows.get(key) ?? []), move.event])
  }
  for (const [arrow, events] of arrows) lines.push(`  ${arrow}: ${events.join(', ')}`)
  for (const state of lifecycle.finalStates) lines.push(`  ${state} --> [*]`)
  return lines.join('\n')
}
