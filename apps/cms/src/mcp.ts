import type { MCPPluginConfig } from '@payloadcms/plugin-mcp';
import type { Field, FieldAccess } from 'payload';
import { isAdmin } from './access/roles';

const USER_FIELD_ACCESS: { create: FieldAccess; update: FieldAccess } = { create: ({ req }) => isAdmin(req.user), update: () => false };

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
  mcp: {
    serverOptions: {
      serverInfo: { name: 'cms', version: '1.0.0' },
      instructions:
        "The website's CMS. Blog posts hold German (locale de, the default) and English (locale en) in one document; read and write one locale at a time. Every write you make is a draft that a publisher reviews and publishes in the admin panel; you cannot publish, unpublish or delete. A post's body is Lexical rich text whose blocks are the website's components.",
    },
  },
  overrideApiKeyCollection: (collection) => ({
    ...collection,
    admin: { ...collection.admin, group: 'Settings' },
    access: {
      ...collection.access,
      read: ({ req }) => (isAdmin(req.user) ? true : req.user ? { user: { equals: req.user.id } } : false),
      update: ({ req }) => (isAdmin(req.user) ? true : req.user ? { user: { equals: req.user.id } } : false),
      delete: ({ req }) => (isAdmin(req.user) ? true : req.user ? { user: { equals: req.user.id } } : false),
    },
    fields: collection.fields.map((field): Field => ('name' in field && field.name === 'user' ? ({ ...field, access: USER_FIELD_ACCESS } as Field) : field)),
  }),
};
