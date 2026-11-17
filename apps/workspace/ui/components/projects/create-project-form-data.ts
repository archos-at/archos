import type { AddressValue } from './address-field'
import { setSitePlace, type SitePlace } from './site-place-fields'
import type { ProjectSetup } from '@/lib/projects/create-project-schema'

export type CreateProjectState = 'active' | 'closed'

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
