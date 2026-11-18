// @disk-inputs: tests/fixtures/workspace/office.json, tests/fixtures/workspace/rendered.json
/**
 * @vitest-environment node
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type WorkspaceFacts, renderWorkspaceBlock } from './workspace-block'

const DIR = join(process.cwd(), 'tests/fixtures/workspace')

interface FixtureOffice {
  current: string
  projects: { id: string; name: string; status: string }[]
  reads: { 'inbox-list': { items: { read: boolean }[] } }
}

function render(): string {
  const office = JSON.parse(readFileSync(join(DIR, 'office.json'), 'utf8')) as FixtureOffice
  const project = office.projects.find((candidate) => candidate.id === office.current)
  if (!project) throw new Error('office.json names a current project it does not hold')
  const facts: WorkspaceFacts = {
    organizationRole: 'admin',
    projectRole: 'project-admin',
    project,
    conversation: { id: '{conversation}', audience: 'solo' },
    inboxWaiting: office.reads['inbox-list'].items.filter((item) => !item.read).length,
    activeRuns: 0,
    proposals: [],
    proposalsTruncated: false,
  }
  const workspace = renderWorkspaceBlock(facts)
  const withOne = renderWorkspaceBlock({
    ...facts,
    proposals: [{ id: '{id}', kind: 'operation', status: 'proposed', summary: '{summary}' }],
  }).split('\n')
  const fixture = {
    comment:
      'Written by bff/turn-context/workspace-block.fixture.spec.ts from office.json; served by ' +
      'scripts/turn_census/fixture_workspace.py. Regenerate with UPDATE_FIXTURES=1.',
    workspace,
    proposalsHeader: withOne.at(-2),
    proposalLine: withOne.at(-1),
  }
  return `${JSON.stringify(fixture, null, 1)}\n`
}

describe('the workspace eval’s WORKSPACE block', () => {
  it('is what the production renderer writes for the fixture office', () => {
    const rendered = render()
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(join(DIR, 'rendered.json'), rendered)
    expect(readFileSync(join(DIR, 'rendered.json'), 'utf8')).toBe(rendered)
  })
})
