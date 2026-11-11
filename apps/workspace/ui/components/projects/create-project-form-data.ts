/**
 * What the create dialog posts to its server action, kept out of the form
 * component so the form stays one organism and this stays a pure function.
 */

import type { AddressValue } from './address-field'
import { setSitePlace, type SitePlace } from './site-place-fields'
import type { ProjectSetup } from '@/lib/projects/create-project-schema'

export type CreateProjectState = 'active' | 'closed'

/**
 * The action's fields. `name`, `state` and `setup` always; the address (the chosen hit, else the typed
 * line and the country and Land chosen beside it), the description and the held drop's key when given; the closed project's facts when it is closed.
 */
export function toFormData(
  value: {
    name: string
    address: AddressValue
    site: SitePlace
    description: string
    state: CreateProjectState
    outcome: string
    startedOn: string
    endedOn: string
  },
  dropKey: string | null,
  setup: ProjectSetup
): FormData {
  const formData = new FormData()
  formData.set('setup', setup)
  if (dropKey) formData.set('dropKey', dropKey)
  formData.set('name', value.name.trim())
  formData.set('state', value.state)
  if (value.description.trim() !== '') formData.set('description', value.description.trim())
  if (value.address.place) formData.set('location', JSON.stringify(value.address.place))
  else if (value.address.text.trim() !== '') formData.set('address', value.address.text.trim())
  if (!value.address.place) setSitePlace(formData, value.site)
  if (value.state !== 'closed') return formData
  formData.set('outcome', value.outcome)
  formData.set('startedOn', value.startedOn)
  formData.set('endedOn', value.endedOn)
  return formData
}
