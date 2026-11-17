import type { GeocodeResult } from '@/lib/geocoding/types'
import type { IntakeView, Suggestion } from '@/lib/project-intake/types'

export const ADDRESS_KEY = 'site_address'
export const FEDERAL_STATE_KEY = 'federal_state'
export const COUNTRY_KEY = 'country'
export const DESCRIPTION_KEY = 'context_description'

export interface DialogFacts {
  address: string | null
  municipality: string | null
  federalState: string | null
  federalStateSuggested: boolean
  description: string | null
}

function profileItem(view: IntakeView, key: string): Suggestion | null {
  for (const group of view.groups) {
    const item = group.items.find((entry) => entry.key === key)
    if (item) return item
  }
  return view.contradictions.find((entry) => entry.key === key) ?? null
}

const text = (item: Suggestion | null): string | null => {
  const value = item?.display.trim()
  return value ? value : null
}

export function dialogFacts(view: IntakeView): DialogFacts {
  const location: GeocodeResult | null = view.location
  const address = text(profileItem(view, ADDRESS_KEY)) ?? location?.label ?? null
  const fromHit = location !== null && address === location.label
  const federalStateItem = profileItem(view, FEDERAL_STATE_KEY)
  return {
    address,
    municipality: fromHit ? location.municipality : null,
    federalState: text(federalStateItem) ?? (fromHit ? location.state : null),
    federalStateSuggested: federalStateItem?.state === 'suggested',
    description: text(profileItem(view, DESCRIPTION_KEY)) ?? view.description,
  }
}
