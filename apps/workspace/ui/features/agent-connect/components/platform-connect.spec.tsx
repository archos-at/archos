import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { PlatformConnect } from './platform-connect'
import { PLATFORM_CONNECT_FIXTURES as F } from './fixtures'

const RUNBOOK = 'https://example.test/runbook'

describe('PlatformConnect', () => {
  test('both: the console address and each cluster server, each with its own setup', () => {
    render(<PlatformConnect state={F.both} runbookHref={RUNBOOK} />)

    const console = screen.getByTestId('platform-connect-console-setup')
    expect(within(console).getByText(F.both.consoleUrl)).toBeInTheDocument()
    expect(within(console).getByText(`claude mcp add --transport http platform ${F.both.consoleUrl}`)).toBeInTheDocument()

    const langfuse = screen.getByTestId('platform-connect-server-langfuse')
    expect(within(langfuse).getByText(F.both.servers[0].url)).toBeInTheDocument()
    expect(
      within(langfuse).getByText(`claude mcp add --transport http langfuse ${F.both.servers[0].url}`),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('platform-connect-cluster-notice')).not.toBeInTheDocument()
  })

  test('the Cursor tab shows the mcp.json entry for that server', async () => {
    render(<PlatformConnect state={F.both} runbookHref={RUNBOOK} />)

    const langfuse = screen.getByTestId('platform-connect-server-langfuse')
    await userEvent.click(within(langfuse).getByRole('tab', { name: 'Cursor' }))
    expect(within(langfuse).getByText(/"mcpServers"/)).toHaveTextContent(`"url": "${F.both.servers[0].url}"`)
  })

  test('says who the cluster servers admit, and links the runbook', () => {
    render(<PlatformConnect state={F.both} runbookHref={RUNBOOK} />)

    expect(screen.getByTestId('platform-connect-cluster')).toHaveTextContent('Only with the Platform owner role')
    expect(screen.getByRole('link', { name: /setup and checks/i })).toHaveAttribute('href', RUNBOOK)
  })

  test('gateway not rolled out: a notice, no address', () => {
    render(<PlatformConnect state={F.consoleOnly} runbookHref={RUNBOOK} />)

    expect(screen.getByTestId('platform-connect-cluster-notice')).toHaveTextContent('Not rolled out in this environment')
    expect(screen.queryByText(/platform-mcp\./)).not.toBeInTheDocument()
  })

  test('no external sign-in: the console says so instead of offering an address that is refused', () => {
    render(<PlatformConnect state={F.neither} runbookHref={RUNBOOK} />)

    expect(screen.getByTestId('platform-connect-console-notice')).toHaveTextContent('Not set up in this installation')
    expect(screen.queryByTestId('platform-connect-console-setup')).not.toBeInTheDocument()
    // What the console offers is still worth knowing before it is set up.
    expect(screen.getByTestId('platform-connect-console')).toHaveTextContent('What your agent can do here')
  })
})
