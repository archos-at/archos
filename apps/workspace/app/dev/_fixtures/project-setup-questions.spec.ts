/**
 * @vitest-environment node
 *
 * The dev fixtures' registers are a snapshot of the real register over Austria's records; the build
 * holds no records, so only this spec reads the pack. UPDATE_SNAPSHOT=1 rewrites the snapshot.
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AT_SETUP_RECORDS } from '@/lib/project-intake/at-setup.fixtures'
import registerSnapshot from './project-setup-questions.registers.json'
import { REGISTER_INPUTS, registerOf } from './project-setup-questions'

const computed = () =>
  JSON.parse(
    JSON.stringify({
      ready: registerOf(REGISTER_INPUTS.ready, AT_SETUP_RECORDS),
      typedAddress: registerOf(REGISTER_INPUTS.typedAddress, AT_SETUP_RECORDS),
      closing: registerOf(REGISTER_INPUTS.closing, AT_SETUP_RECORDS),
      done: registerOf(REGISTER_INPUTS.done, AT_SETUP_RECORDS),
    })
  )

describe('the questions fixtures’ registers', () => {
  it('are what the real register computes from Austria’s records', () => {
    if (process.env.UPDATE_SNAPSHOT) {
      writeFileSync(new URL('./project-setup-questions.registers.json', import.meta.url), `${JSON.stringify(computed(), null, 2)}\n`)
    }
    expect(registerSnapshot).toEqual(computed())
  })
})
