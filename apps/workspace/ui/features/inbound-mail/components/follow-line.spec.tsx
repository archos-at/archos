import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files',
  useSearchParams: () => new URLSearchParams(),
}))

import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { MAIL_THREAD_VARIANTS, PROJECT_ID, THREAD_DOCUMENT_ID, THREAD_FOLDER_ID, VIEWER_ID, fixtureMailThreadClient } from '@/app/dev/mail-thread/fixtures'
import { MailThreadTab } from '@/features/documents/components/mail-thread'
import { PRODUCT_NAME } from '@/lib/brand'
import { FollowLine } from './follow-line'

describe('filing replies without a click, in „Übersicht“ and in the Verlauf’s „E-Mails“ tab', () => {
  it('is a quiet line in „Übersicht“ with one press, the switch in the tab, and one explanation in both', async () => {
    const fixture = MAIL_THREAD_VARIANTS['three-messages']
    render(
      <>
        <section data-testid="dialog">
          <FollowLine follow onFollow={() => undefined} />
        </section>
        <section data-testid="tab">
          <MailThreadTab
            projectId={PROJECT_ID}
            documentId={THREAD_DOCUMENT_ID}
            threadId={fixture.view.id}
            folderId={THREAD_FOLDER_ID}
            viewerUserId={VIEWER_ID}
            client={fixtureMailThreadClient(fixture)}
          />
        </section>
      </>
    )
    const dialog = screen.getByTestId('dialog')
    expect(within(dialog).queryByRole('switch')).toBeNull()
    expect(within(dialog).getByTestId('filing-follow')).toHaveTextContent(`${PRODUCT_NAME} files further replies in this mail thread without a click · Switch off`)
    expect(within(dialog).getByRole('button', { name: 'Switch off' })).toHaveAccessibleDescription(`${PRODUCT_NAME} files further replies in this mail thread without a click`)

    const inTab = await within(screen.getByTestId('tab')).findByRole('switch')
    expect(inTab).toHaveAccessibleName('File replies in this mail thread without a click')
    expect(inTab).toBeChecked()
    const explanation = screen.getByTestId('tab').querySelector('[id$="-explain"]')?.textContent
    expect(explanation).toBeTruthy()
    expect(within(dialog).getByTestId('filing-follow-explain')).toHaveAccessibleName(explanation ?? '')
    expect(screen.getByTestId('mail-thread-follow-switch-state')).toHaveTextContent(/^On until /)
  })

  it('says the other state and offers to switch it on again', async () => {
    const onFollow = vi.fn()
    render(<FollowLine follow={false} onFollow={onFollow} />)
    expect(screen.getByTestId('filing-follow-state')).toHaveTextContent('Further replies in this mail thread wait in Project mail')
    await userEvent.click(screen.getByRole('button', { name: 'Switch on' }))
    expect(onFollow).toHaveBeenCalledWith(true)
  })
})
