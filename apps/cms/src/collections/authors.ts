/** The people a post names as its author, for the byline and the post's structured data. */
import type { CollectionConfig } from 'payload';
import { canDraft, canPublish, roleOf } from '../access/roles';

export const Authors: CollectionConfig = {
  slug: 'authors',
  admin: { useAsTitle: 'name', group: 'Content' },
  access: {
    read: ({ req }) => canDraft(req.user) || roleOf(req.user) === 'website' || roleOf(req.user) === 'social-handoff',
    create: ({ req }) => canDraft(req.user),
    update: ({ req }) => canDraft(req.user),
    delete: ({ req }) => canPublish(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'jobTitle', type: 'text', localized: true, admin: { description: 'As it appears under the name, e.g. Architect, co-founder.' } },
    { name: 'profileUrl', type: 'text', admin: { description: "A public profile (LinkedIn, a website). Goes into the post's structured data as sameAs." } },
  ],
};
