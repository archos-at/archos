/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

describe('the retention sweep and the app agree', () => {
  it('purges at the ceiling and the floor the retention setting accepts', async () => {
    const { DOWNLOAD_LOG_MAX_DAYS, DOWNLOAD_LOG_MIN_DAYS } = await import('../../workers/maintenance-sql.js')
    const { DOWNLOAD_LOG_MAX_RETENTION_DAYS, DOWNLOAD_LOG_MIN_RETENTION_DAYS } = await import('./kinds')

    expect(DOWNLOAD_LOG_MAX_DAYS).toBe(DOWNLOAD_LOG_MAX_RETENTION_DAYS)
    expect(DOWNLOAD_LOG_MIN_DAYS).toBe(DOWNLOAD_LOG_MIN_RETENTION_DAYS)
  })

  it('selects the organizations by the setting key the app reads and writes', async () => {
    const { pruneDownloadLog } = await import('../../workers/maintenance-sql.js')
    const { DOWNLOAD_LOG_RETENTION_SETTING } = await import('./kinds')
    const statements: string[] = []
    const record = (text: string) => {
      statements.push(text)
      return Promise.resolve([])
    }
    const tx = Object.assign((strings: TemplateStringsArray) => record(strings.join('?')), { unsafe: record })

    await pruneDownloadLog({ begin: (run: (client: typeof tx) => Promise<unknown>) => run(tx) })

    expect(statements.find((text) => text.includes('FROM organizations'))).toContain(
      `settings->>'${DOWNLOAD_LOG_RETENTION_SETTING}'`
    )
  })
})
