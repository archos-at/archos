import type { SwitchableOrganization } from '@/lib/organizations/switchable'
import type { SidebarUser } from './sidebar-user-menu'

export interface ShellAccount {
  user?: SidebarUser
  organizationName?: string | null
  authRequired: boolean
  organizations?: readonly SwitchableOrganization[]
  canManageOrganization?: boolean
  canViewOrganization?: boolean
  canManagePlatform?: boolean
}

const SHELL_ACCOUNT_KEYS = [
  'user',
  'organizationName',
  'authRequired',
  'organizations',
  'canManageOrganization',
  'canViewOrganization',
  'canManagePlatform',
] as const satisfies readonly (keyof ShellAccount)[]

type Exhaustive<Listed extends readonly PropertyKey[], All extends PropertyKey> = [All] extends [Listed[number]] ? Listed : never

const KEYS: Exhaustive<typeof SHELL_ACCOUNT_KEYS, keyof ShellAccount> = SHELL_ACCOUNT_KEYS

export function shellAccount(from: ShellAccount): ShellAccount {
  return Object.fromEntries(KEYS.map((key) => [key, from[key]])) as unknown as ShellAccount
}
