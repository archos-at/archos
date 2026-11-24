/**
 * @vitest-environment node
 *
 * The boot line, and the pin that keeps its two implementations identical.
 *
 * `bff/boot.ts` is canonical; `bff/boot-line.js` is the CommonJS copy
 * `server.js` prints, because it cannot import a TS module. A copy that nothing
 * compares is a copy that drifts, and the drift here is silent: two containers
 * of the same deployment would print two different answers to "what is
 * running", which is precisely the question the line exists to settle. So both
 * run over the same table, and the gateway is booted to see it print the line.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { bootLine, deployedSha, flagSource, formatBootLine, UNKNOWN_SHA } from '@/lib/boot'
import { bootLogLine } from '@/lib/boot-line.js'

const CASES: Array<{ name: string; env: Record<string, string>; expected: string }> = [
  {
    name: 'an unstamped image with nothing configured — the compose defaults',
    env: {},
    expected: '[boot] sha=unknown flags=defaults',
  },
  {
    name: 'a published image that signs people in',
    env: {
      GIT_SHA: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c', // pragma: allowlist secret
      REQUIRE_AUTH: 'true',
    },
    expected: '[boot] sha=0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c flags=workos', // pragma: allowlist secret
  },
  {
    name: 'REQUIRE_AUTH=false is the anonymous deployment, not WorkOS',
    env: { GIT_SHA: 'abc1234', REQUIRE_AUTH: 'false' },
    expected: '[boot] sha=abc1234 flags=defaults',
  },
  {
    name: 'only the exact word true signs people in — "1" does not',
    env: { REQUIRE_AUTH: '1' },
    expected: '[boot] sha=unknown flags=defaults',
  },
  {
    name: 'case is ignored and the sha is trimmed, as an env_file produces them',
    env: { GIT_SHA: '  deadbeef  ', REQUIRE_AUTH: 'TRUE' },
    expected: '[boot] sha=deadbeef flags=workos',
  },
  {
    name: 'a padded REQUIRE_AUTH is anonymous, because isAuthRequired reads it so',
    env: { REQUIRE_AUTH: ' true ' },
    expected: '[boot] sha=unknown flags=defaults',
  },
  {
    name: 'an empty GIT_SHA is an unstamped image, not an empty sha',
    env: { GIT_SHA: '' },
    expected: '[boot] sha=unknown flags=defaults',
  },
]

describe('the boot line', () => {
  it.each(CASES)('formats $name', ({ env, expected }) => {
    const typed = env as unknown as NodeJS.ProcessEnv
    expect(formatBootLine({ sha: deployedSha(typed), flags: flagSource(typed) })).toBe(expected)
    expect(bootLine(typed)).toBe(expected)
  })

  it('names an unstamped image `unknown` rather than leaving the field empty', () => {
    expect(deployedSha({} as NodeJS.ProcessEnv)).toBe(UNKNOWN_SHA)
    expect(bootLine({} as NodeJS.ProcessEnv)).toContain(`sha=${UNKNOWN_SHA}`)
  })

  it('keeps every field on ONE line — the operator greps for it', () => {
    for (const { env } of CASES) {
      expect(bootLine(env as unknown as NodeJS.ProcessEnv).split('\n')).toHaveLength(1)
    }
    expect(bootLine({} as NodeJS.ProcessEnv).startsWith('[boot] ')).toBe(true)
  })
})

describe("server.js's CommonJS copy of the boot line", () => {
  it.each(CASES)('agrees with lib/boot.ts on $name', ({ env, expected }) => {
    expect(bootLogLine(env)).toBe(expected)
  })
})

describe('the gateway', () => {
  const running: ChildProcess[] = []
  afterEach(() => {
    while (running.length) running.pop()?.kill('SIGKILL')
  })

  function bootGateway(env: Record<string, string>): Promise<string> {
    const inherited = { ...process.env }
    delete inherited.REDIS_URL
    const child = spawn('node', ['server.js'], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...inherited,
        NODE_ENV: 'development',
        PORT: '0',
        HOSTNAME: '127.0.0.1',
        BACKEND_CHAT_URL: 'http://127.0.0.1:9',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    running.push(child)
    return new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`gateway did not start; saw:\n${output}`)), 20_000)
      const collect = (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes('Frontend:')) {
          clearTimeout(timer)
          resolve(output)
        }
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`gateway exited (${code}) before listening; saw:\n${output}`))
      })
    })
  }

  it('prints the boot line once it listens, so a booted gateway always says what is running', async () => {
    const output = await bootGateway({ GIT_SHA: 'abc1234', REQUIRE_AUTH: 'true' })
    expect(output.split('\n')).toContain('[boot] sha=abc1234 flags=workos')
  })
})
