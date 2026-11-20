import { z } from 'zod'
import { platformOrgBudgetPutSchema } from '@/lib/budgets/platform-contract'
import { storageQuotaPutSchema, uploadLimitPutSchema } from '@/lib/storage/contract'
import type { AgentOperation } from '../operation'

const organizationParams = z.object({
  organizationId: z.string().describe('The organization id, from platform-overview-get.'),
})

export const platformOrganizationOperations = [
  {
    name: 'platform-overview-get',
    domain: 'platform',
    summary: 'Platform overview across all organizations',
    description:
      'The operator dashboard in one read: every organization with its headline figures. Start here for organization ids; ' +
      'the platform-org-* operations take one. Platform operators only.',
    method: 'GET',
    path: '/api/platform/overview',
    load: () => import('@/app/api/platform/overview/route'),
  },
  {
    name: 'platform-storage-overview',
    domain: 'platform',
    summary: 'Storage use of every organization',
    description:
      'Storage used and quota per organization, for the whole platform. Use it to find an organization near its quota, ' +
      'then change it with platform-org-storage-update.',
    method: 'GET',
    path: '/api/platform/storage',
    load: () => import('@/app/api/platform/storage/route'),
  },
  {
    name: 'platform-audit-portal-link',
    domain: 'platform',
    summary: 'Get an Admin Portal link to the platform audit log',
    description:
      'Generates a short-lived WorkOS Admin Portal link to the platform organization’s audit-log viewer, where break-glass ' +
      'access and other platform events land. Returns `{ link }`; open it in a browser. The link is a credential to the ' +
      'platform audit log: hand it to nobody else.',
    method: 'POST',
    path: '/api/platform/audit-portal',
    idempotent: false,
    sensitivity: 'secret',
    load: () => import('@/app/api/platform/audit-portal/route'),
  },

  {
    name: 'platform-org-budget-get',
    domain: 'platform',
    summary: 'Read an organization’s credit budget',
    description:
      'The daily and monthly credit limits of one organization and what the platform default would give it. ' +
      'Organization ids come from platform-overview-get. Change it with platform-org-budget-update.',
    method: 'GET',
    path: '/api/platform/organizations/[organizationId]/budgets',
    params: organizationParams,
    load: () => import('@/app/api/platform/organizations/[organizationId]/budgets/route'),
  },
  {
    name: 'platform-org-budget-update',
    domain: 'platform',
    summary: 'Set an organization’s credit budget',
    description:
      'Replaces the credit limits of one organization. Read the current values with platform-org-budget-get first. ' +
      'Takes effect on the organization’s next generation and is audited.',
    method: 'PUT',
    path: '/api/platform/organizations/[organizationId]/budgets',
    params: organizationParams,
    body: platformOrgBudgetPutSchema,
    load: () => import('@/app/api/platform/organizations/[organizationId]/budgets/route'),
  },
  {
    name: 'platform-org-usage-get',
    domain: 'platform',
    summary: 'Read an organization’s credit usage',
    description:
      'Credits one organization has used against its budget. Organization ids come from platform-overview-get; ' +
      'compare with platform-org-budget-get.',
    method: 'GET',
    path: '/api/platform/organizations/[organizationId]/usage',
    params: organizationParams,
    load: () => import('@/app/api/platform/organizations/[organizationId]/usage/route'),
  },
  {
    name: 'platform-org-storage-get',
    domain: 'platform',
    summary: 'Read an organization’s storage quota and use',
    description:
      'Bytes stored and the quota of one organization. Organization ids come from platform-overview-get. ' +
      'Change the quota with platform-org-storage-update.',
    method: 'GET',
    path: '/api/platform/organizations/[organizationId]/storage',
    params: organizationParams,
    load: () => import('@/app/api/platform/organizations/[organizationId]/storage/route'),
  },
  {
    name: 'platform-org-storage-update',
    domain: 'platform',
    summary: 'Set an organization’s storage quota',
    description:
      'Sets the storage quota in bytes for one organization (the route’s schema bounds the value). ' +
      'Read the current figure with platform-org-storage-get first. Audited.',
    method: 'PUT',
    path: '/api/platform/organizations/[organizationId]/storage',
    params: organizationParams,
    body: storageQuotaPutSchema,
    load: () => import('@/app/api/platform/organizations/[organizationId]/storage/route'),
  },
  {
    name: 'platform-org-upload-limit-update',
    domain: 'platform',
    summary: 'Set an organization’s maximum upload file size',
    description:
      'Sets the largest single file one organization may upload, in bytes, within the platform ceiling. ' +
      'Organization ids come from platform-overview-get. Audited.',
    method: 'PUT',
    path: '/api/platform/organizations/[organizationId]/upload-limit',
    params: organizationParams,
    body: uploadLimitPutSchema,
    load: () => import('@/app/api/platform/organizations/[organizationId]/upload-limit/route'),
  },
] as const satisfies readonly AgentOperation[]
