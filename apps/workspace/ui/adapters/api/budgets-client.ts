import type { z } from 'zod'
import type { budgetDeleteSchema, budgetPutSchema } from '@/lib/organizations/organization-wire'
import { ApiRequestError } from './api-error'

export type BudgetPolicyInput = z.input<typeof budgetPutSchema>

export type BudgetPolicyRemoval = z.input<typeof budgetDeleteSchema>

const BUDGETS_PATH = '/api/organization/budgets'

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

const failure = (context: string, status: number): ApiRequestError =>
  new ApiRequestError(`${context}: ${status}`, status)

export const setBudgetPolicy = async (input: BudgetPolicyInput): Promise<void> => {
  const response = await fetch(BUDGETS_PATH, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw failure('Failed to save budget policy', response.status)
}

export const removeBudgetPolicy = async (input: BudgetPolicyRemoval): Promise<void> => {
  const response = await fetch(BUDGETS_PATH, {
    method: 'DELETE',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  })
  if (!response.ok) throw failure('Failed to remove budget policy', response.status)
}
