/**
 * Uploaded images: image covers, images in a post, a social post's own image.
 * Stored in SeaweedFS (bucket `cms-files`, `@payloadcms/storage-s3`) when the
 * deployment configures it, on local disk otherwise.
 *
 * The sizes are the only renditions served, cut at the focal point the editor
 * sets: `cover` and `cover-small` the card's and the post's 3:2, `share` the
 * share card's 1200 x 630 (LinkedIn's 1.91:1), `inline` and `inline-small` an
 * image in a post. No SVG: the website inlines nothing from here, and an SVG
 * can carry script.
 *
 * Files are public: the website's visitors load them from the CMS's host. A
 * file uploaded for a draft is reachable by whoever knows its name.
 */
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
