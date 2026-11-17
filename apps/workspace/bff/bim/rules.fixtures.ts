import { runBimRules as runOnSite, type BimRuleFacts } from './rules'
import { SETTLED_BASES } from './rule-basis.fixtures'
import type { BimElement } from './types'

export const runBimRules = (elements: readonly BimElement[], facts: Partial<BimRuleFacts> = {}) =>
  runOnSite(elements, { bases: SETTLED_BASES, ...facts })

export function element(overrides: Partial<BimElement> & Pick<BimElement, 'ifcType'>): BimElement {
  return {
    globalId: `g-${overrides.name ?? overrides.ifcType}`,
    expressId: 1,
    name: null,
    description: null,
    predefinedType: null,
    objectType: null,
    tag: null,
    typeName: null,
    containerKind: 'storey',
    containerGlobalId: null,
    containerName: 'Erdgeschoss',
    storeyGlobalId: 's-eg',
    storeyName: 'Erdgeschoss',
    materials: [],
    classifications: [],
    properties: {},
    quantities: {},
    ...overrides,
  }
}

export const ruleOf = (results: ReturnType<typeof runBimRules>, id: string) => {
  const found = results.find((result) => result.ruleId === id)
  if (!found) throw new Error(`no such rule: ${id}`)
  return found
}

export const STOREYS = [
  { name: 'Keller', elevation: -2.8 },
  { name: 'Erdgeschoss', elevation: 0 },
  { name: 'Obergeschoss', elevation: 3 },
]
