/**
 * The review rules as pure functions (src/access/). tests/int/editorial.int.test.ts
 * proves the same rules through Payload's operations on a real database.
 */
import { expect, test } from 'vitest';
import { livePosts, mayWrite } from '../src/access/editorial';
import { canDraft, canPublish, canUseAdminPanel, ROLES } from '../src/access/roles';
import { socialStatusAllowed } from '../src/access/social';
import { MCP_OPTIONS } from '../src/mcp';

const as = (role: string) => ({ id: 1, role });

test('only an administrator and a publisher publish; robots draft nothing', () => {
  expect(ROLES.filter((r) => canPublish(as(r)))).toEqual(['admin', 'publisher']);
  expect(ROLES.filter((r) => canDraft(as(r)))).toEqual(['admin', 'publisher', 'editor', 'agent']);
  expect(ROLES.filter((r) => canUseAdminPanel(as(r)))).toEqual(['admin', 'publisher', 'editor']);
  expect(canDraft(null)).toBe(false);
  expect(canDraft(as('superuser'))).toBe(false);
});

test('a write that publishes needs a publisher; a draft needs anyone who drafts', () => {
  expect(mayWrite(as('editor'), { _status: 'published' })).toBe(false);
  expect(mayWrite(as('agent'), { _status: 'draft' })).toBe(true);
  expect(mayWrite(as('publisher'), { _status: 'published' })).toBe(true);
  expect(mayWrite(as('website'), {})).toBe(false);
});

test('the website reads posts that are published and due', () => {
  expect(livePosts(new Date('2026-11-05T10:00:00Z'))).toEqual({
    and: [{ _status: { equals: 'published' } }, { publishedAt: { less_than_equal: '2026-11-05T10:00:00.000Z' } }],
  });
});

test('a social post is approved by a publisher only, and the hand-off only moves an approved one on', () => {
  expect(socialStatusAllowed(as('editor'), 'in_review', 'approved')).toBe(false);
  expect(socialStatusAllowed(as('agent'), undefined, 'in_review')).toBe(true);
  expect(socialStatusAllowed(as('agent'), 'approved', 'draft')).toBe(false);
  expect(socialStatusAllowed(as('publisher'), 'in_review', 'approved')).toBe(true);
  expect(socialStatusAllowed(as('social-handoff'), 'approved', 'scheduled')).toBe(true);
  expect(socialStatusAllowed(as('social-handoff'), 'in_review', 'scheduled')).toBe(false);
  expect(socialStatusAllowed(as('social-handoff'), 'approved', 'published')).toBe(false);
  expect(socialStatusAllowed(as('website'), undefined, 'draft')).toBe(false);
});

test('the MCP server offers no delete and no users, keys or jobs', () => {
  const collections = MCP_OPTIONS.collections ?? {};
  for (const [slug, { enabled }] of Object.entries(collections)) {
    expect(enabled === true || (typeof enabled === 'object' && enabled.delete), slug).toBeFalsy();
  }
  expect(Object.keys(collections)).not.toContain('users');
  expect(Object.keys(collections)).not.toContain('payload-mcp-api-keys');
  expect(MCP_OPTIONS.experimental).toBeUndefined();
});
