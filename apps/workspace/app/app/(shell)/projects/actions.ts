'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isNewProjectDropKey } from '@/features/documents/lib/dropped-file-handover'
import { withPageSession } from '@/lib/auth/require-auth'
import { BadRequestError } from '@/lib/api/errors'
import { createProjectFieldsSchema, isAgentSetup, type ProjectSetup } from '@/lib/projects/create-project-schema'
import { isMonth } from '@/lib/projects/month'
import { PROJECT_OUTCOMES, type ProjectOutcome } from '@/lib/projects/project-status'
import {
  createProject as createProjectInOrg,
  type CreateProjectInput,
  type ProjectClosing,
} from '@/lib/projects/service'

export interface CreateProjectState {
  error?: string
  reason?: string
}

export async function createProject(
  _prevState: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const projectId = await withPageSession(async (session) => {
    const name = formData.get('name')
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 255) {
      return { error: 'Project name is required and must be 1-255 characters.' } as const
    }

    const closing = closingFromForm(formData)
    if (closing && 'error' in closing) return closing

    const setup = setupFromForm(formData)
    if ('error' in setup) return setup

    try {
      const project = await createProjectInOrg(session, {
        name: name.trim(),
        ...(closing ? { closing } : {}),
        ...setup,
      })
      return { id: project.id, closed: closing !== undefined, setup: setup.setup } as const
    } catch (error) {
      console.error('[createProject] Failed to create project:', error)
      const reason = reasonOf(error)
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(reason ? { reason } : {}),
      } as const
    }
  })

  if ('error' in projectId) {
    return { error: projectId.error, ...(projectId.reason ? { reason: projectId.reason } : {}) }
  }

  revalidatePath('/app', 'layout')
  redirect(createdProjectPath(projectId, formData.get('dropKey')))
}

function createdProjectPath(created: { id: string; closed: boolean; setup: ProjectSetup }, dropKey: unknown): string {
  if (isAgentSetup(created.setup)) {
    const drop = isNewProjectDropKey(dropKey) ? `?drop=${encodeURIComponent(dropKey)}` : ''
    return `/app/projects/${created.id}/setup${drop}`
  }
  return created.closed ? `/app/projects/${created.id}/settings` : `/app/projects/${created.id}/intake`
}

type FormRefusal = { error: string; reason: string }

function closingFromForm(formData: FormData): ProjectClosing | FormRefusal | undefined {
  if (formData.get('state') !== 'closed') return undefined
  const outcome = formData.get('outcome')
  if (!isOutcome(outcome)) {
    return { error: 'Choose how the project ended.', reason: 'invalid-outcome' }
  }
  const endedOn = formData.get('endedOn')
  const startedOn = formData.get('startedOn') ?? ''
  if (typeof endedOn !== 'string' || !isMonth(endedOn)) {
    return { error: 'The Abschluss must be a month, YYYY-MM.', reason: 'invalid-month' }
  }
  if (typeof startedOn !== 'string' || (startedOn !== '' && !isMonth(startedOn))) {
    return { error: 'The Beginn must be a month, YYYY-MM.', reason: 'invalid-month' }
  }
  return { outcome, endedOn, startedOn: startedOn === '' ? null : startedOn }
}

function setupFromForm(
  formData: FormData
): (Required<Pick<CreateProjectInput, 'setup'>> & Pick<CreateProjectInput, 'description' | 'location' | 'address' | 'federalState' | 'country'>) | FormRefusal {
  const location = formData.get('location')
  const parsed = createProjectFieldsSchema.pick({ setup: true, description: true, location: true, address: true, federalState: true, country: true }).safeParse({
    setup: formData.get('setup') ?? 'self',
    description: formData.get('description') ?? undefined,
    location: typeof location === 'string' && location !== '' ? safeJson(location) : undefined,
    address: formData.get('address') ?? undefined,
    federalState: formData.get('federal_state') || undefined,
    country: formData.get('country') || undefined,
  })
  if (!parsed.success) return { error: 'The setup details are not valid.', reason: 'invalid-setup' }
  const { setup, description, location: place, address, federalState, country } = parsed.data
  return {
    setup,
    ...(description ? { description } : {}),
    ...(place ? { location: place } : address ? { address } : {}),
    ...(federalState ? { federalState } : {}),
    ...(country ? { country } : {}),
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isOutcome(value: unknown): value is ProjectOutcome {
  return typeof value === 'string' && (PROJECT_OUTCOMES as readonly string[]).includes(value)
}

function reasonOf(error: unknown): string | undefined {
  if (!(error instanceof BadRequestError)) return undefined
  const reason = (error.details as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' ? reason : undefined
}
