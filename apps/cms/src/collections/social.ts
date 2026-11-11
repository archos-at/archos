/**
 * The company's social posts (ADR-0155): drafted here (by a person, an agent,
 * the publish job or social/release-summaries.mjs), approved by a publisher,
 * handed to Buffer by social/handoff.mjs. One post is one text for one account
 * in one language. `access/social.ts` holds who may move a post where.
 */
import type { CollectionConfig } from 'payload';
import { canDraft, canPublish, roleOf } from '../access/roles';
import {
  contentWritable,
  createSocialPosts,
  deleteSocialPosts,
  guardSocialStatus,
  notByHandoff,
  readSocialPosts,
  SOCIAL_STATUSES,
  updateSocialPosts,
} from '../access/social';
import { LOCALES, NETWORKS, options } from '../fields/choices';

export const SocialAccounts: CollectionConfig = {
  slug: 'social-accounts',
  admin: { useAsTitle: 'label', group: 'Social' },
  access: {
    read: ({ req }) => canDraft(req.user) || roleOf(req.user) === 'social-handoff',
    create: ({ req }) => canPublish(req.user),
    update: ({ req }) => canPublish(req.user),
    delete: ({ req }) => canPublish(req.user),
  },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, admin: { description: 'Stable key, e.g. linkedin-company. Part of every tracked link (utm_content).' } },
    { name: 'label', type: 'text', required: true },
    { name: 'network', type: 'select', required: true, options: options(NETWORKS) },
    { name: 'maxLength', type: 'number', required: true, defaultValue: 3000, admin: { description: "The network's character limit for a post. LinkedIn: 3000." } },
    {
      name: 'publisherChannelId',
      type: 'text',
      admin: { description: 'The channel id of this account in Buffer. Empty: approved posts are published by hand.' },
    },
    { name: 'active', type: 'checkbox', defaultValue: true },
  ],
};

/** Locked once the post is handed over: Buffer holds a copy that an edit here would not reach. */
const untilHandedOver = { update: contentWritable };
const handoffMayNot = { update: notByHandoff };

export const SocialPosts: CollectionConfig = {
  slug: 'social-posts',
  admin: { useAsTitle: 'text', group: 'Social', defaultColumns: ['text', 'account', 'language', 'status', 'scheduledAt'] },
  access: {
    read: readSocialPosts,
    create: createSocialPosts,
    update: updateSocialPosts,
    delete: deleteSocialPosts,
  },
  versions: { maxPerDoc: 50 },
  hooks: { beforeChange: [guardSocialStatus] },
  fields: [
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: options(SOCIAL_STATUSES),
      admin: {
        position: 'sidebar',
        description:
          'draft -> in_review -> approved (a publisher) -> sending -> scheduled (Buffer holds it) -> published. Only a publisher approves; only the hand-off sets sending and scheduled. From sending on the text, link, image and time are locked: change or delete the post in Buffer, then set it failed here to edit it and send it again.',
      },
    },
    { name: 'account', type: 'relationship', relationTo: 'social-accounts', required: true, access: untilHandedOver },
    { name: 'language', type: 'select', required: true, options: options(LOCALES), access: untilHandedOver },
    {
      name: 'text',
      type: 'textarea',
      required: true,
      maxLength: 3000,
      access: untilHandedOver,
      admin: { description: 'The post as it appears. LinkedIn shows about the first 210 characters before "see more"; the tracked link is added at the end.' },
    },
    { name: 'blogPost', type: 'relationship', relationTo: 'posts', access: untilHandedOver, admin: { description: 'The post this one promotes. Its link and share image are used unless set below.' } },
    { name: 'linkUrl', type: 'text', access: untilHandedOver, admin: { description: 'A page of the website to link instead of (or without) a blog post. Absolute, without tracking parameters.' } },
    { name: 'utmCampaign', type: 'text', access: untilHandedOver, admin: { description: "Defaults to the blog post's slug. Lower-case, hyphens." } },
    { name: 'image', type: 'upload', relationTo: 'media', access: untilHandedOver, admin: { description: "Optional. Defaults to the blog post's share image." } },
    {
      name: 'scheduledAt',
      type: 'date',
      access: untilHandedOver,
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' }, description: "When it should go out. Empty: the next free slot of the account's queue." },
    },
    { name: 'sourceRef', type: 'text', index: true, access: handoffMayNot, admin: { position: 'sidebar', readOnly: true, description: 'Set by whatever drafted it, so a re-run never drafts it twice.' } },
    { name: 'externalId', type: 'text', admin: { position: 'sidebar', readOnly: true, description: 'The id Buffer gave the post. Empty while sending: the hand-off has not recorded the answer yet.' } },
    { name: 'publishError', type: 'textarea', admin: { position: 'sidebar', readOnly: true } },
  ],
};
