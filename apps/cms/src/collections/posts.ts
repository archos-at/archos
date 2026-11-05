/**
 * The website's blog posts (ADR-0155). One post holds both languages
 * (`localized` fields), so the twins of a post can no longer point at a slug
 * nobody checked. Drafts, versions and autosave are on: a published post is
 * edited in a draft, and a publisher publishes it, now or at a time
 * (`schedulePublish`, run by the jobs queue). Who may do what:
 * `access/editorial.ts`.
 */
import type { CollectionConfig } from 'payload';
import { deletePosts, draftsUnlessPublisher, readPosts, readPostVersions, writePosts } from '../access/editorial';
import { CATEGORIES, COVER_DRAWINGS, options } from '../fields/choices';
import { postBodyEditor } from '../fields/post-body';
import { revalidateAfterChange, revalidateAfterDelete } from '../hooks/revalidate-website';
import { queueSocialDrafts } from '../jobs/draft-social-posts';
import { livePreviewUrl, previewEndpoint } from '../preview';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Blog post', plural: 'Blog posts' },
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'publishedAt', 'stage', '_status'],
    listSearchableFields: ['title', 'slug'],
    livePreview: { url: livePreviewUrl },
    preview: (doc, { locale }) => livePreviewUrl({ data: doc as { id?: number | string }, locale }),
  },
  access: {
    read: readPosts,
    readVersions: readPostVersions,
    create: writePosts,
    update: writePosts,
    delete: deletePosts,
  },
  versions: {
    maxPerDoc: 100,
    drafts: { autosave: { interval: 2000 }, schedulePublish: true },
  },
  endpoints: [previewEndpoint],
  hooks: {
    beforeOperation: [draftsUnlessPublisher],
    afterChange: [revalidateAfterChange, queueSocialDrafts],
    afterDelete: [revalidateAfterDelete],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Content',
          fields: [
            {
              name: 'title',
              type: 'text',
              required: true,
              localized: true,
              admin: { description: 'A soft hyphen (U+00AD) marks where a long compound may break in the heading.' },
            },
            {
              name: 'description',
              type: 'textarea',
              required: true,
              localized: true,
              admin: { description: 'One or two sentences: the listing teaser, the meta description and the feed summary.' },
            },
            {
              name: 'body',
              type: 'richText',
              localized: true,
              editor: postBodyEditor,
              admin: { description: 'Text with headings, lists, links, tables and quotes; figures, images, a gallery, callouts and calls to action are blocks (+ or /).' },
            },
          ],
        },
        {
          label: 'Cover',
          fields: [
            { name: 'coverType', type: 'radio', required: true, defaultValue: 'drawing', options: options(['drawing', 'image']) },
            {
              name: 'cover',
              type: 'select',
              options: options(COVER_DRAWINGS),
              admin: {
                condition: (_, sibling) => sibling?.coverType !== 'image',
                description: 'A line drawing from apps/website/src/assets/covers. A new drawing is a pull request (packages/brand/docs/blog-covers.md).',
              },
            },
            {
              name: 'coverImage',
              type: 'upload',
              relationTo: 'media',
              admin: {
                condition: (_, sibling) => sibling?.coverType === 'image',
                description: 'At least 1600 x 1067 px. Set its focal point: the website crops it to 3:2 for the post and 1200 x 630 for the share card.',
              },
            },
            {
              name: 'coverAlt',
              type: 'text',
              localized: true,
              admin: { condition: (_, sibling) => sibling?.coverType === 'image', description: 'What the image shows, for screen readers.' },
            },
          ],
        },
        {
          label: 'SEO',
          fields: [
            {
              name: 'seo',
              type: 'group',
              fields: [
                { name: 'title', type: 'text', localized: true, admin: { description: 'Optional. The <title> and share title when the title is too long for a search result.' } },
                { name: 'description', type: 'textarea', localized: true, admin: { description: 'Optional. Overrides the description in search results and share cards.' } },
                { name: 'noindex', type: 'checkbox', localized: true, defaultValue: false, admin: { description: 'Keep this language out of search engines and the sitemap.' } },
              ],
            },
            {
              name: 'previousSlugs',
              type: 'text',
              hasMany: true,
              localized: true,
              admin: { description: 'Slugs this post had before. Their URLs answer with a 301 to the current one.' },
            },
          ],
        },
      ],
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      localized: true,
      unique: true,
      index: true,
      validate: (value: unknown) =>
        value === undefined || value === null || (typeof value === 'string' && SLUG.test(value)) || 'Lower-case words joined by hyphens.',
      admin: { position: 'sidebar', description: 'The last segment of the URL: /blog/<slug>/ or /en/blog/<slug>/.' },
    },
    {
      name: 'publishedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: { position: 'sidebar', description: 'The date the post shows and sorts by. A published post with a future date appears then.' },
    },
    { name: 'category', type: 'select', required: true, options: options(CATEGORIES), admin: { position: 'sidebar' } },
    { name: 'author', type: 'relationship', relationTo: 'authors', admin: { position: 'sidebar' } },
    {
      // What scripts/import-blog.ts last wrote, as a hash: a post whose content no longer
      // matches it was edited here since, and a re-run leaves it alone.
      name: 'importHash',
      type: 'text',
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: 'stage',
      type: 'select',
      defaultValue: 'writing',
      options: [
        { label: 'Writing', value: 'writing' },
        { label: 'Ready for review', value: 'in_review' },
      ],
      admin: { position: 'sidebar', description: 'Set "Ready for review" when a publisher should read it. Publishing is a publisher\'s.' },
    },
  ],
};
