import { PRODUCT_NAME } from '@/lib/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files/mail',
  useSearchParams: () => new URLSearchParams(),
}))

import { toast } from 'sonner'
import { render, screen, waitFor, within } from '@/test-utils'
import { ApiRequestError } from '@/adapters/api/api-error'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient } from '@/app/dev/inbound-mail/fixtures'
import type { InboundMailClient } from '../lib/client'
import { InboundMailDetail } from './inbound-mail-detail'

function renderDetail(name: string, client: InboundMailClient = fixtureClient({ detail: DETAIL_VARIANTS[name] }), onChanged = vi.fn()) {
  const fixture = DETAIL_VARIANTS[name]
  render(
    <InboundMailDetail
      projectId={PROJECT_ID}
      mailId={fixture.view.id}
      initial={fixture.view}
      initialText={fixture.text}
      folders={FOLDERS}
      client={client}
      onChanged={onChanged}
      now={FIXTURE_NOW}
      pollMs={1}
    />
  )
  return { client, onChanged, mailId: fixture.view.id }
}

const WHAT =
  'The warning names the sender and the subject and says: “Please do not pay and do not reply. Check your mail program for the same mail.” ' +
  `Then the mail is dismissed in ${PRODUCT_NAME}; delete it in your mail program yourself.`

beforeEach(() => {
  vi.clearAllMocks()
})

describe('„Melden …“ in the fraud stop', () => {
  it('says who is warned and that the mail is then dismissed, and reports nothing until the person confirms', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-name'] })
    const report = vi.spyOn(client, 'report')
    renderDetail('member-name', client)
    const warning = screen.getByTestId('impersonation-warning')
    expect(within(warning).getByTestId('fraud-report')).toHaveTextContent('Report …Warns your office so nobody pays.')

    await userEvent.click(within(warning).getByTestId('fraud-report-open'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Report this fraud attempt?')
    expect(dialog).toHaveTextContent(`${PRODUCT_NAME} warns whoever manages this project, your office’s administrators and Miriam Huber.`)
    expect(dialog).toHaveTextContent(WHAT)
    expect(report).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(report).not.toHaveBeenCalled()
  })

  it('reports and dismisses in one press, says how many were warned, and leaves nothing to report again', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['impersonation-colleague'] })
    const report = vi.spyOn(client, 'report')
    const dismiss = vi.spyOn(client, 'dismiss')
    const { onChanged, mailId } = renderDetail('impersonation-colleague', client)

    await userEvent.click(screen.getByTestId('fraud-report-open'))
    await userEvent.click(await screen.findByTestId('fraud-report-confirm'))

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    expect(report).toHaveBeenCalledWith(PROJECT_ID, mailId)
    expect(dismiss).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Reported and dismissed. 3 people are warned.', expect.anything())
    expect(onChanged).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('fraud-report')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names nobody else to the member whose own address it carries', async () => {
    renderDetail('impersonation')
    await userEvent.click(screen.getByTestId('fraud-report-open'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(`${PRODUCT_NAME} warns whoever manages this project and your office’s administrators.`)
    expect(dialog).not.toHaveTextContent('Miriam Huber')
  })

  it('tells the reporter to warn the office themselves when nobody else could be warned', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-name'] })
    const base = client.report
    vi.spyOn(client, 'report').mockImplementation(async (projectId, mailId) => ({ ...(await base(projectId, mailId)), warned: 0 }))
    renderDetail('member-name', client)
    await userEvent.click(screen.getByTestId('fraud-report-open'))
    await userEvent.click(await screen.findByTestId('fraud-report-confirm'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dismissed. Nobody else manages this project: warn your office yourself.', expect.anything()))
  })

  it('says why a report was refused and reads the mail again when it changed', async () => {
    const client = fixtureClient({ detail: DETAIL_VARIANTS['member-name'] })
    vi.spyOn(client, 'report').mockRejectedValue(new ApiRequestError('gone', 409, 'part_not_waiting'))
    const get = vi.spyOn(client, 'get')
    renderDetail('member-name', client)
    await userEvent.click(screen.getByTestId('fraud-report-open'))
    await userEvent.click(await screen.findByTestId('fraud-report-confirm'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A part of this mail no longer waits. It was read again.', expect.anything()))
    await waitFor(() => expect(get).toHaveBeenCalled())
  })

  it('offers no report on a mail that poses as nobody', () => {
    renderDetail('external-unverified')
    expect(screen.queryByTestId('fraud-report')).toBeNull()
  })
})
