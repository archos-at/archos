// oxlint's RuleTester refuses Bun (`rawTransferRuntimeSupported` in oxlint/dist/plugins-dev.js),
// so the rule specs run on `node --test` and the tester reports through its describe and it.
import { describe, it } from 'node:test'
import { RuleTester } from 'oxlint/plugins-dev'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

export { RuleTester }
