import path from 'node:path';
import type { CollectionConfig } from 'payload';
import { canDraft, canPublish } from '../access/roles';

export const IMAGE_SIZES = ['cover', 'cover-small', 'share', 'inline', 'inline-small'] as const;

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Content' },
  access: {
    read: () => true,
    create: ({ req }) => canDraft(req.user),
    update: ({ req }) => canDraft(req.user),
    delete: ({ req }) => canPublish(req.user),
  },
  upload: {
    staticDir: path.resolve(process.cwd(), 'media'),
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    focalPoint: true,
    crop: true,
    imageSizes: [
      { name: 'cover', width: 1600, height: 1067, formatOptions: { format: 'webp', options: { quality: 82 } } },
      { name: 'cover-small', width: 800, height: 533, formatOptions: { format: 'webp', options: { quality: 82 } } },
      { name: 'share', width: 1200, height: 630, formatOptions: { format: 'jpeg', options: { quality: 85 } } },
      { name: 'inline', width: 1600, withoutEnlargement: true, formatOptions: { format: 'webp', options: { quality: 85 } } },
      { name: 'inline-small', width: 800, withoutEnlargement: true, formatOptions: { format: 'webp', options: { quality: 85 } } },
    ],
    adminThumbnail: 'cover-small',
  },
  fields: [
    { name: 'alt', type: 'text', required: true, admin: { description: 'What the image shows, for the library. A post sets its own alt text per language.' } },
    {
      name: 'aiGenerated',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Made or changed by an image model. The website then marks it, as the design system requires.' },
    },
  ],
};
