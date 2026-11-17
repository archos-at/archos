import { render, screen, within } from '@/test-utils'
import { describe, expect, test, vi } from 'vitest'

import { translatorFor } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import type { OrganizationMemberWithRole } from '@/lib/organizations/service'
import { PeopleDirectory } from './people-directory'

vi.mock('@workos-inc/widgets', () => ({
  WorkOsWidgets: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  UsersManagement: () => <div data-testid="users-management" />,
}))

const t = translatorFor(organizationCopy, 'en')

const member = (over: Partial<OrganizationMemberWithRole> = {}): OrganizationMemberWithRole => ({
  id: 'user_1',
  email: 'anna.weber@buero.at',
  name: 'Anna Weber',
  roleSlug: 'member',
  status: 'active',
  ...over,
})

const rowFor = (email: string): HTMLElement =>
  within(screen.getByRole('table')).getByText(email).closest('tr') as HTMLElement

const cardFor = (email: string): HTMLElement =>
  within(screen.getByTestId('people-cards')).getByText(email).closest('li') as HTMLElement

describe('PeopleDirectory', () => {
  test('renders the human role name from the catalog, keeping the slug beside it', () => {
    render(
      <PeopleDirectory
        members={[member({ roleSlug: 'org-billing-admin' })]}
        showManagement={false}
      />
    )

    const row = rowFor('anna.weber@buero.at')
    expect(within(row).getByText('Billing Admin')).toBeInTheDocument()
    expect(within(row).getByText('org-billing-admin')).toBeInTheDocument()
  })

  test('falls back to the raw slug for a role the catalog does not know', () => {
    render(
      <PeopleDirectory
        members={[member({ roleSlug: 'org-fire-marshal' })]}
        showManagement={false}
      />
    )

    const row = rowFor('anna.weber@buero.at')
    expect(within(row).getByText('org-fire-marshal')).toBeInTheDocument()
  })

  test('renders an explicit string when a membership carries no role', () => {
    render(<PeopleDirectory members={[member({ roleSlug: null })]} showManagement={false} />)

    const row = rowFor('anna.weber@buero.at')
    expect(within(row).getByText(t('access.people.noRole'))).toBeInTheDocument()
  })

  test('a member WorkOS knows only by email still gets a row', () => {
    render(<PeopleDirectory members={[member({ name: null })]} showManagement={false} />)

    const row = rowFor('anna.weber@buero.at')
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  test('prints the membership status exactly as WorkOS returned it', () => {
    render(<PeopleDirectory members={[member({ status: 'quarantined' })]} showManagement={false} />)

    expect(within(rowFor('anna.weber@buero.at')).getByText('quarantined')).toBeInTheDocument()
  })

  test('below sm the same member is a card carrying name, email, role and status', () => {
    render(
      <PeopleDirectory
        members={[member({ roleSlug: 'org-billing-admin', status: 'pending' })]}
        showManagement={false}
      />
    )

    const card = cardFor('anna.weber@buero.at')
    expect(within(card).getByText('Anna Weber')).toBeInTheDocument()
    expect(within(card).getByText('Billing Admin')).toBeInTheDocument()
    expect(within(card).getByText('org-billing-admin')).toBeInTheDocument()
    expect(within(card).getByText('pending')).toBeInTheDocument()
    expect(screen.getByTestId('people-cards')).toHaveClass('sm:hidden')
    expect(screen.getByRole('table')).toHaveClass('max-sm:hidden')
  })

  test('a failed roster load shows the error state instead of an empty table', () => {
    render(<PeopleDirectory members={[]} error showManagement={false} />)

    expect(screen.getByText(t('access.people.loadError'))).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(t('access.people.empty'))).not.toBeInTheDocument()
  })

  test('an organization with no members reads as empty, not as broken', () => {
    render(<PeopleDirectory members={[]} showManagement={false} />)

    expect(screen.getByText(t('access.people.empty'))).toBeInTheDocument()
    expect(screen.queryByText(t('access.people.loadError'))).not.toBeInTheDocument()
  })

  test('renders the WorkOS management widget beneath the directory by default', () => {
    render(<PeopleDirectory members={[member()]} />)

    expect(screen.getByTestId('users-management')).toBeInTheDocument()
  })
})
