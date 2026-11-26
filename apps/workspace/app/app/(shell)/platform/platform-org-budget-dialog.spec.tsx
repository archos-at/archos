import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { PlatformOrgBudgetDialog } from './platform-org-budget-dialog'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const budget = {
  organizationId: 'org_tenant',
  unit: 'credit',
  dailyLimit: 1000,
  monthlyLimit: 10000,
  explicit: false,
  dayUsed: 25,
  monthUsed: 300,
  ingest: {
    unit: 'credit',
    monthlyAllowance: 30000,
    defaultMonthlyAllowance: 30000,
    defaultFactor: 3,
    explicit: false,
    monthUsed: 4200,
  },
  canManage: true,
}
const INGEST_LABEL = 'Ingest allowance per month (credits)'
const ingestUrl = '/api/platform/organizations/org_tenant/ingest-allowance'
const organization = { id: 'org_tenant', name: 'Planning Office' }
const onClose = vi.fn()
const response = (body: unknown, status = 200) => Response.json(body, { status })
const fetchMock = vi.fn()

describe('platform organization allowance editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(response(budget))
  })

  it('loads the selected org allowance and current usage without writing', async () => {
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    expect(await screen.findByLabelText('Monthly allowance (credits)')).toHaveValue('10000')
    expect(screen.getByLabelText('Daily limit (credits)')).toHaveValue('1000')
    expect(screen.getByText('Default allowance')).toBeDefined()
    expect(screen.getByText('Used today').nextElementSibling).toHaveTextContent('25 credits')
    expect(screen.getByText('Used this month').nextElementSibling).toHaveTextContent('300 credits')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledWith('/api/platform/organizations/org_tenant/budgets', {
      credentials: 'same-origin',
    })
  })

  it('can pin the default allowance as a per-org custom allowance without changing its amount', async () => {
    fetchMock
      .mockResolvedValueOnce(response(budget))
      .mockResolvedValueOnce(response({ ...budget, explicit: true }))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    await screen.findByLabelText('Monthly allowance (credits)')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      dailyLimit: 1000,
      monthlyLimit: 10000,
    })
  })

  it('does not create another policy when a custom allowance has not changed', async () => {
    fetchMock.mockResolvedValue(response({ ...budget, explicit: true }))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    await screen.findByLabelText('Monthly allowance (credits)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves a different monthly allowance for this org, preserving its daily limit', async () => {
    fetchMock
      .mockResolvedValueOnce(response(budget))
      .mockResolvedValueOnce(response({ ...budget, monthlyLimit: 25000 }))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    const monthly = await screen.findByLabelText('Monthly allowance (credits)')
    await userEvent.clear(monthly)
    await userEvent.type(monthly, '25000')
    await userEvent.type(screen.getByLabelText('Change note (optional)'), 'Pilot plan')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/platform/organizations/org_tenant/budgets', {
      credentials: 'same-origin',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit: 'credit',
        dailyLimit: 1000,
        monthlyLimit: 25000,
        note: 'Pilot plan',
      }),
    })
  })

  it('sends blank as unlimited and zero as a blocking allowance', async () => {
    fetchMock.mockResolvedValueOnce(response(budget)).mockResolvedValueOnce(response(budget))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    await userEvent.clear(await screen.findByLabelText('Monthly allowance (credits)'))
    const daily = screen.getByLabelText('Daily limit (credits)')
    await userEvent.clear(daily)
    await userEvent.type(daily, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      dailyLimit: 0,
      monthlyLimit: null,
    })
  })

  it.each(['oops', '-1', '12oops', '100000000', '2.5x', '0x10', '1e3'])(
    'does not silently save invalid input %s as unlimited',
    async (value) => {
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const monthly = await screen.findByLabelText('Monthly allowance (credits)')
      await userEvent.clear(monthly)
      await userEvent.type(monthly, value)
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a number')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('provides read-only support with no write controls', async () => {
    fetchMock.mockResolvedValue(response({ ...budget, explicit: true, canManage: false }))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    expect(await screen.findByLabelText('Monthly allowance (credits)')).toHaveAttribute('readonly')
    expect(screen.getByText('Custom allowance')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByLabelText('Change note (optional)')).toBeNull()
  })

  it('lets a failed load be retried', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response(budget))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Monthly allowance (credits)')).toHaveValue('10000')
  })

  it('keeps the draft open and reports a failed save', async () => {
    fetchMock.mockResolvedValueOnce(response(budget)).mockResolvedValueOnce(response({}, 500))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    const monthly = await screen.findByLabelText('Monthly allowance (credits)')
    await userEvent.clear(monthly)
    await userEvent.type(monthly, '20000')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save the organization allowance.')
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(monthly).toHaveValue('20000')
  })

  it('explains a stale unit conflict without closing or reporting success', async () => {
    fetchMock.mockResolvedValueOnce(response(budget)).mockResolvedValueOnce(response({}, 409))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    await userEvent.type(await screen.findByLabelText('Monthly allowance (credits)'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('changed its budget unit'))
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('marks only the field that is wrong, as a field error', async () => {
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    const monthly = await screen.findByLabelText('Monthly allowance (credits)')
    await userEvent.clear(monthly)
    await userEvent.type(monthly, 'ten')
    expect(monthly).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Daily limit (credits)')).not.toHaveAttribute('aria-invalid')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('reads a German decimal comma', async () => {
    fetchMock.mockResolvedValueOnce(response(budget)).mockResolvedValueOnce(response(budget))
    render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
    const daily = await screen.findByLabelText('Daily limit (credits)')
    await userEvent.clear(daily)
    await userEvent.type(daily, '12,5')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ dailyLimit: 12.5 })
  })

  it('hides the write path when the shell says the viewer cannot manage organizations', async () => {
    render(
      <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.organizationsView]}>
        <PlatformOrgBudgetDialog organization={organization} onClose={onClose} />
      </PlatformAccessProvider>
    )
    expect(await screen.findByLabelText('Monthly allowance (credits)')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(
      screen.getByText('You can view this allowance, but do not have permission to change it.')
    ).toBeDefined()
  })

  describe('the ingest allowance', () => {
    const explicitBudget = {
      ...budget,
      explicit: true,
      ingest: { ...budget.ingest, monthlyAllowance: 50000, explicit: true },
    }

    it('shows the default as a placeholder, and what was read in this month', async () => {
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const field = await screen.findByLabelText(INGEST_LABEL)
      expect(field).toHaveValue('')
      expect(field).toHaveAttribute('placeholder', 'Default: 30,000')
      expect(screen.getByText('Read in this month').nextElementSibling).toHaveTextContent(
        '4,200 credits'
      )
      expect(screen.getByText('Default')).toBeDefined()
    })

    it('follows the monthly allowance being typed in the placeholder', async () => {
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const monthly = await screen.findByLabelText('Monthly allowance (credits)')
      await userEvent.clear(monthly)
      await userEvent.type(monthly, '20000')
      expect(screen.getByLabelText(INGEST_LABEL)).toHaveAttribute('placeholder', 'Default: 60,000')
      await userEvent.clear(monthly)
      expect(screen.getByLabelText(INGEST_LABEL)).toHaveAttribute(
        'placeholder',
        'Default: unlimited'
      )
    })

    it('saves only the ingest allowance, without pinning the default limits as a policy', async () => {
      fetchMock
        .mockResolvedValueOnce(response(budget))
        .mockResolvedValueOnce(response(explicitBudget.ingest))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      await userEvent.type(await screen.findByLabelText(INGEST_LABEL), '50000')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenLastCalledWith(ingestUrl, {
        credentials: 'same-origin',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: 'credit', monthlyAllowance: 50000 }),
      })
    })

    it('goes back to the default with one click', async () => {
      fetchMock
        .mockResolvedValueOnce(response(explicitBudget))
        .mockResolvedValueOnce(response(budget.ingest))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      expect(await screen.findByLabelText(INGEST_LABEL)).toHaveValue('50000')
      expect(screen.getByText('Custom')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Use default' }))
      expect(screen.getByLabelText(INGEST_LABEL)).toHaveValue('')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(fetchMock.mock.calls[1][0]).toBe(ingestUrl)
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        unit: 'credit',
        monthlyAllowance: null,
      })
    })

    it('saves the limits first, then the ingest allowance, when both changed', async () => {
      fetchMock
        .mockResolvedValueOnce(response(explicitBudget))
        .mockResolvedValueOnce(response(explicitBudget))
        .mockResolvedValueOnce(response(explicitBudget.ingest))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const monthly = await screen.findByLabelText('Monthly allowance (credits)')
      await userEvent.clear(monthly)
      await userEvent.type(monthly, '20000')
      const ingest = screen.getByLabelText(INGEST_LABEL)
      await userEvent.clear(ingest)
      await userEvent.type(ingest, '0')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
        ['/api/platform/organizations/org_tenant/budgets', undefined],
        ['/api/platform/organizations/org_tenant/budgets', 'PUT'],
        [ingestUrl, 'PUT'],
      ])
      expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
        unit: 'credit',
        monthlyAllowance: 0,
      })
    })

    it('refuses a negative amount and names the ingest failure', async () => {
      fetchMock.mockResolvedValueOnce(response(budget)).mockResolvedValueOnce(response({}, 500))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const ingest = await screen.findByLabelText(INGEST_LABEL)
      await userEvent.type(ingest, '-5')
      expect(screen.getByRole('alert')).toHaveTextContent('or leave blank for the default')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.clear(ingest)
      await userEvent.type(ingest, '5')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not save the ingest allowance.')
      )
      expect(onClose).not.toHaveBeenCalled()
    })

    it('says the limits were saved when only the ingest allowance failed after them', async () => {
      fetchMock
        .mockResolvedValueOnce(response(explicitBudget))
        .mockResolvedValueOnce(response(explicitBudget))
        .mockResolvedValueOnce(response({}, 500))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      const monthly = await screen.findByLabelText('Monthly allowance (credits)')
      await userEvent.clear(monthly)
      await userEvent.type(monthly, '20000')
      const ingest = screen.getByLabelText(INGEST_LABEL)
      await userEvent.clear(ingest)
      await userEvent.type(ingest, '7')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'The limits were saved, but the ingest allowance could not be saved.'
        )
      )
      expect(onClose).not.toHaveBeenCalled()
    })

    it('is read-only without the manage permission', async () => {
      fetchMock.mockResolvedValue(response({ ...explicitBudget, canManage: false }))
      render(<PlatformOrgBudgetDialog organization={organization} onClose={onClose} />)
      expect(await screen.findByLabelText(INGEST_LABEL)).toHaveAttribute('readonly')
      expect(screen.queryByRole('button', { name: 'Use default' })).toBeNull()
    })
  })
})
