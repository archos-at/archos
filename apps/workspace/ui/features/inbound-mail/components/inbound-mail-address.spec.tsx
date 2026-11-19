import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
const download = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('@/lib/browser-download', () => ({ startBrowserDownload: download.start, downloadFetched: vi.fn() }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { toast } from 'sonner'
import { capturePosthog } from '@/lib/analytics/posthog'
import { render, screen, waitFor, within } from '@/test-utils'
import { ADDRESS_VARIANTS, PROJECT_ID, PROJECT_NAME, fixtureAddressClient } from '@/app/dev/inbound-mail/fixtures'
import {
  INBOUND_MAIL_ADDRESS_STATS_DAYS,
  INBOUND_MAIL_MAX_ATTACHMENT_BYTES,
  INBOUND_MAIL_MAX_MESSAGE_BYTES,
} from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { InboundMailAddressCard, InboundMailAddressDialog, InboundMailAddressTile } from './inbound-mail-address'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'

const MIB = 1024 * 1024
const ADDRESS = 'project+bauplatz-12-wohnbau-seestadt.k3x7q2m5p4ab@inbox.example.org'

const APP_CONFIG: AppConfig = { authRequired: false, fileUpload: getFileUploadConfigFromEnv({}) }

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:card')
  URL.revokeObjectURL = vi.fn()
})

async function openSetup(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByTestId('address-setup-toggle'))
  return screen.getByTestId('address-setup')
}

describe('InboundMailAddressCard', () => {
  it('leads with the one sentence and the address with „Copy“, and folds the setup away', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    expect(await screen.findByTestId('address-lead')).toHaveTextContent('Put this address in Cc when you write about the project.')
    expect(screen.getByTestId('address-value')).toHaveTextContent(ADDRESS)
    expect(screen.getByTestId('address-copy')).toHaveTextContent('Copy')
    expect(screen.getByTestId('address-setup-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('own-domain-dkim')).toBeNull()
    expect(screen.queryByTestId('address-forwards')).toBeNull()
    expect(screen.queryByTestId('address-rotate')).toBeNull()
  })

  it('saves it as a contact, and says the card is for Outlook or a phone', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    expect(await screen.findByTestId('address-hand-on-contact')).toHaveTextContent('contact card (.vcf) for Outlook or your phone')
    await userEvent.click(screen.getByTestId('address-save-contact'))
    expect(download.start).toHaveBeenCalledWith('blob:card', expect.stringMatching(/-bauplatz-12-wohnbau-seestadt\.vcf$/))
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_address_contact_saved', { surface: 'settings' })
  })

  it('hands the address on by a new email that carries it and says what it is for', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    const share = await screen.findByTestId('address-share')
    expect(within(screen.getByTestId('address-hand-on-share')).getByText(/Opens a new email with the address/)).toBeInTheDocument()
    const href = decodeURIComponent(share.getAttribute('href') ?? '')
    expect(href).toMatch(/^mailto:\?subject=Project mail address of Bauplatz 12/)
    expect(href).toContain(ADDRESS)
    expect(href).toContain('Put this address in Cc when you write about the project')
  })

  it('counts a copy of the address, by the door it was copied from', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    await userEvent.click(await screen.findByTestId('address-copy'))
    await waitFor(() => expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_address_copied', { surface: 'settings' }))
    expect(writeText).toHaveBeenCalledWith(ADDRESS)
    expect(screen.getByTestId('address-copy')).toHaveTextContent('Copied')
  })

  it('wraps the address only after the +, before the token and before the @, never inside the domain', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    const shown = await screen.findByText(ADDRESS)
    const lines = Array.from(shown.childNodes).reduce<string[]>(
      (pieces, node) => (node.nodeName === 'WBR' ? [...pieces, ''] : [...pieces.slice(0, -1), `${pieces.at(-1)}${node.textContent}`]),
      ['']
    )
    expect(lines).toEqual(['project+', 'bauplatz-12-wohnbau-seestadt', '.k3x7q2m5p4ab', '@inbox.example.org'])
    expect(screen.getByTestId('address-value').className).not.toContain('break-all')
  })

  it('tells a member nothing about the office’s own signing: that is a manager’s to fix', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    await openSetup()
    expect(screen.queryByTestId('own-domain-dkim')).not.toBeInTheDocument()
  })

  it('replaces the address from the ⋯ menu, behind a warning that says what happens to the old one and to waiting mail', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const rotate = vi.spyOn(client, 'rotate')
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await userEvent.click(await screen.findByTestId('address-manage'))
    expect(await screen.findByTestId('address-rotate')).toHaveTextContent('The current one stops working at once.')
    expect(screen.getByTestId('address-switch-off')).toHaveTextContent('New mail to the project no longer arrives.')
    await userEvent.click(screen.getByTestId('address-rotate'))
    expect(screen.getByText(/The current address stops working at once. Mail sent to it goes back to its sender as undeliverable/)).toBeInTheDocument()
    expect(screen.getByText(/Mail already waiting in Project mail stays there and can still be filed/)).toBeInTheDocument()
    expect(screen.getByText(/no longer filed without a click in any mail thread/)).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('address-rotate-confirm'))
    await waitFor(() => expect(rotate).toHaveBeenCalledWith(PROJECT_ID))
    expect(toast.success).toHaveBeenCalledWith('New address created')
    expect(await screen.findByText('project+bauplatz-12-wohnbau-seestadt.w6n2c4r7t3qz@inbox.example.org')).toBeInTheDocument()
  })

  it('says, before switching off, that the address does not come back and waiting mail stays', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const remove = vi.spyOn(client, 'remove')
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await userEvent.click(await screen.findByTestId('address-manage'))
    await userEvent.click(await screen.findByTestId('address-switch-off'))
    expect(screen.getByText(/This address does not come back/)).toBeInTheDocument()
    expect(screen.getByText(/Mail already waiting in Project mail stays there/)).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('address-switch-off-confirm'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(PROJECT_ID))
  })

  it('offers a member no way to change it', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    await screen.findByTestId('inbound-mail-address')
    expect(screen.queryByTestId('address-manage')).not.toBeInTheDocument()
  })

  it('lets a manager create a missing address, and tells a member whom to ask', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.off)
    const create = vi.spyOn(client, 'create')
    const { unmount } = render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await userEvent.click(await screen.findByTestId('address-create'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    unmount()
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS['off-member'])} />)
    expect(await screen.findByText(/Ask someone who manages the project/)).toBeInTheDocument()
  })

  it('says when this installation receives no mail, and when the address failed to load', async () => {
    const { unmount } = render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.unavailable)} />)
    expect(await screen.findByTestId('address-unavailable')).toBeInTheDocument()
    unmount()
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient('error')} />)
    expect(await screen.findByText('The project mail address could not be loaded.')).toBeInTheDocument()
  })

  it('says under the setup how often the office’s own mail arrives confirmed, or that its domain signs nothing', async () => {
    const { unmount } = render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    expect(await openSetup()).toContainElement(screen.getByTestId('own-domain-dkim'))
    expect(screen.getByTestId('own-domain-dkim')).toHaveTextContent('94 % of your office’s mail')
    unmount()
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS['own-dkim-missing'])} />)
    await openSetup()
    expect(screen.getByTestId('own-domain-dkim')).toHaveAttribute('data-state', 'missing')
  })

  it('links the guide and the signing help into the website the server names, in the reader’s language', async () => {
    const config: AppConfig = { ...APP_CONFIG, publicSiteUrl: 'https://site.example.test' }
    render(
      <AppConfigProvider config={config}>
        <InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS['own-dkim-missing'])} />
      </AppConfigProvider>
    )
    expect(await screen.findByRole('link', { name: /Guide/ })).toHaveAttribute('href', 'https://site.example.test/en/project-mail/')
    await openSetup()
    expect(screen.getByRole('link', { name: /does not sign/ })).toHaveAttribute('href', 'https://site.example.test/en/project-mail/#dkim')
  })

  it('shows no link into the website when the server names none, rather than a wrong one', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS['own-dkim-missing'])} />)
    await openSetup()
    expect(screen.getByTestId('own-domain-dkim')).toHaveTextContent('does not sign')
    expect(screen.queryByRole('link', { name: /Guide/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /does not sign/ })).not.toBeInTheDocument()
  })

  it('says the window its figures look back over from the constant, not from the copy', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.refusals)} />)
    const address = await screen.findByTestId('inbound-mail-address')
    expect(address).toHaveTextContent(`17 automatic replies or delivery reports in the last ${INBOUND_MAIL_ADDRESS_STATS_DAYS} days, not shown`)
    await openSetup()
    expect(screen.getByTestId('own-domain-dkim')).toHaveTextContent(`in the last ${INBOUND_MAIL_ADDRESS_STATS_DAYS} days`)
  })
})

describe('InboundMailAddressCard: the setup for whoever runs the office’s mail', () => {
  it('says how to redirect an existing project address, with the address filled in, copyable', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    expect(await screen.findByTestId('address-setup-toggle')).toHaveTextContent('For IT: setup')
    await openSetup()
    expect(screen.getByTestId('address-setup-redirect')).toHaveTextContent(`redirect it to ${ADDRESS} with an Outlook rule. Choose “redirect”, not “forward”`)
    await userEvent.click(screen.getByTestId('address-setup-redirect-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`to ${ADDRESS} with an Outlook rule`)))
    expect(screen.getByTestId('address-setup-redirect-copy')).toHaveTextContent('Instructions copied')
  })

  it('lets a manager register an existing project address, explains what it does, and saves it lowercase', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const save = vi.spyOn(client, 'setForwardedFrom')
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await openSetup()
    expect(screen.getByTestId('address-forwards')).toHaveTextContent('A mail to one of these addresses that your office redirects here counts as sent to the project.')
    expect(screen.getByTestId('address-forwards-none')).toBeInTheDocument()
    await userEvent.type(screen.getByTestId('address-forward-input'), 'Bauplatz12@Huber-Architektur.at{Enter}')
    await waitFor(() => expect(save).toHaveBeenCalledWith(PROJECT_ID, ['bauplatz12@huber-architektur.at']))
    expect(await screen.findByTestId('address-forward')).toHaveTextContent('bauplatz12@huber-architektur.at')
    expect(screen.getByTestId('address-forward-input')).toHaveValue('')
    expect(toast.success).toHaveBeenCalledWith('Saved')
  })

  it('says why it refuses what is not an address, or the project address itself, before saving anything', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const save = vi.spyOn(client, 'setForwardedFrom')
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await openSetup()
    await userEvent.type(screen.getByTestId('address-forward-input'), 'kienberg{Enter}')
    expect(screen.getByTestId('address-forward-problem')).toHaveTextContent('Enter an email address')
    await userEvent.clear(screen.getByTestId('address-forward-input'))
    await userEvent.type(screen.getByTestId('address-forward-input'), `${ADDRESS}{Enter}`)
    expect(screen.getByTestId('address-forward-problem')).toHaveTextContent('Enter your office’s address')
    expect(save).not.toHaveBeenCalled()
  })

  it('removes one, and shows a member the list without a way to change it', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.forwards)
    const save = vi.spyOn(client, 'setForwardedFrom')
    const { unmount } = render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await openSetup()
    await userEvent.click(screen.getAllByTestId('address-forward-remove')[0])
    await waitFor(() => expect(save).toHaveBeenCalledWith(PROJECT_ID, ['seestadt-wohnbau@huber-architektur.at']))
    unmount()
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS['forwards-member'])} />)
    await openSetup()
    expect(screen.getByTestId('address-forward')).toHaveTextContent('bauplatz12@huber-architektur.at')
    expect(screen.queryByTestId('address-forward-input')).toBeNull()
    expect(screen.queryByTestId('address-forward-remove')).toBeNull()
  })
})

describe('the size a mail may have', () => {
  it('states the limit beside the address, from the server’s constant, what a larger mail meets, and the upload for it', async () => {
    render(<InboundMailAddressCard projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    const line = await screen.findByTestId('address-size-limit')
    expect(INBOUND_MAIL_MAX_MESSAGE_BYTES).toBe(25 * MIB)
    expect(line).toHaveTextContent(
      `Up to 25 MB per mail, attachments together about ${Math.floor(INBOUND_MAIL_MAX_ATTACHMENT_BYTES / MIB)} MB. A larger mail goes back to its sender as undeliverable. Upload larger files directly`
    )
    expect(line).toHaveTextContent('about 18 MB')
    expect(screen.getByTestId('address-upload-instead')).toHaveAttribute('href', `/app/projects/${PROJECT_ID}/files`)
  })

  it('closes the dialog when the upload is taken instead, so Dateien is not behind it', async () => {
    const onOpenChange = vi.fn()
    render(<InboundMailAddressDialog projectId={PROJECT_ID} projectName={PROJECT_NAME} open onOpenChange={onOpenChange} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    await userEvent.click(await screen.findByTestId('address-upload-instead'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('states it on the overview’s tile too', async () => {
    render(<InboundMailAddressTile projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    expect(await screen.findByTestId('address-size-limit')).toHaveTextContent('Up to 25 MB per mail, attachments together about 18 MB')
  })
})

describe('InboundMailAddressDialog', () => {
  it('reads the address only while open, and leads with the one sentence before the address', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const get = vi.spyOn(client, 'get')
    const { rerender } = render(<InboundMailAddressDialog projectId={PROJECT_ID} projectName={PROJECT_NAME} open={false} onOpenChange={vi.fn()} client={client} />)
    expect(get).not.toHaveBeenCalled()
    rerender(<InboundMailAddressDialog projectId={PROJECT_ID} projectName={PROJECT_NAME} open onOpenChange={vi.fn()} client={client} />)
    const lead = await screen.findByTestId('address-lead')
    expect(lead).toHaveTextContent('Put this address in Cc when you write about the project. The replies then land in Project mail under Files.')
    expect(lead.compareDocumentPosition(await screen.findByText(ADDRESS)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('address-held')).toHaveTextContent('Everything else waits in Project mail until someone files it; mail from outside the office for 14 days.')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('tells Project mail from the Inbox in one line', async () => {
    render(<InboundMailAddressDialog projectId={PROJECT_ID} projectName={PROJECT_NAME} open onOpenChange={vi.fn()} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    expect(await screen.findByTestId('address-not-postfach')).toHaveTextContent('Project mail collects mail sent to the project. The Inbox shows notices for you.')
  })

  it('shows no signing statistics, not even to a manager: the dialog is where everyone learns the address', async () => {
    render(<InboundMailAddressDialog projectId={PROJECT_ID} projectName={PROJECT_NAME} open onOpenChange={vi.fn()} client={fixtureAddressClient(ADDRESS_VARIANTS.manager)} />)
    await openSetup()
    expect(screen.queryByTestId('own-domain-dkim')).not.toBeInTheDocument()
    expect(screen.queryByTestId('address-forwards')).not.toBeInTheDocument()
  })
})

describe('InboundMailAddressTile', () => {
  it('hands out the address on the project overview, with what it is for and the way to the mail', async () => {
    render(<InboundMailAddressTile projectId={PROJECT_ID} projectName={PROJECT_NAME} client={fixtureAddressClient(ADDRESS_VARIANTS.member)} />)
    const tile = await screen.findByTestId('inbound-mail-address-tile')
    expect(tile).toHaveTextContent('Put in Cc, it brings the replies')
    expect(tile).toHaveTextContent(ADDRESS)
    expect(screen.getByRole('link', { name: /Open Project mail/ })).toHaveAttribute('href', `/app/projects/${PROJECT_ID}/files/mail`)
    await userEvent.click(screen.getByTestId('address-save-contact'))
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_address_contact_saved', { surface: 'overview' })
  })

  it('draws nothing while the project has no address', async () => {
    const client = fixtureAddressClient(ADDRESS_VARIANTS.off)
    const get = vi.spyOn(client, 'get')
    render(<InboundMailAddressTile projectId={PROJECT_ID} projectName={PROJECT_NAME} client={client} />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(screen.queryByTestId('inbound-mail-address-tile')).not.toBeInTheDocument()
  })
})
