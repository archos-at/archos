/**
 * The MCP server (`POST /api/mcp`, @payloadcms/plugin-mcp): how Claude, Cursor
 * and our own agent work in the CMS (ADR-0155).
 *
 * An MCP client authenticates with an API key a person creates in the admin
 * panel (MCP > API Keys); the key acts as that person, so every rule in
 * `access/` applies to it unchanged, and for an editor or an agent every write
 * is a draft. Each key also switches each operation below on or off for itself.
 *
 * Offered here: find, create and update, never delete. Users, keys and jobs are
 * not offered at all, and the plugin's experimental tools (which edit the
 * config, collections and jobs as code) stay off.
 */
import type { MCPPluginConfig } from '@payloadcms/plugin-mcp';
import { isAdmin } from './access/roles';

const DRAFT_ONLY = { find: true, create: true, update: true, delete: false };

export const MCP_OPTIONS: MCPPluginConfig = {
  collections: {
    posts: {
      enabled: DRAFT_ONLY,
      description:
        "The website's blog posts, German and English in one document (pass `locale`). Writes are drafts: a publisher reviews and publishes in the admin panel. The body is a list of blocks: text (Markdown), figure, image, quote, cta.",
    },
    authors: { enabled: { find: true, create: true, update: true, delete: false }, description: 'Bylines for blog posts.' },
    media: { enabled: { find: true, create: false, update: true, delete: false }, description: 'Uploaded images. Alt text and the AI flag can be edited; uploads go through the admin panel.' },
    'social-posts': {
      enabled: DRAFT_ONLY,
      description: 'Social posts (LinkedIn) in one language each. An agent drafts (status draft or in_review); a publisher approves; the hand-off sends approved posts to Buffer.',
    },
    'social-accounts': { enabled: { find: true, create: false, update: false, delete: false }, description: 'The accounts social posts go out on.' },
  },
  // Only an administrator sees and manages every key; anyone else manages their own (the plugin's default).
  overrideApiKeyCollection: (collection) => ({
    ...collection,
    admin: { ...collection.admin, group: 'Settings' },
    access: {
      ...collection.access,
      read: ({ req }) => (isAdmin(req.user) ? true : req.user ? { user: { equals: req.user.id } } : false),
    },
  }),
};
