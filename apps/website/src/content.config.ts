import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { CATEGORY_IDS } from './lib/categories';
import { COVER_IDS } from './lib/covers';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    draft: z.boolean().default(false),
    category: z.enum(CATEGORY_IDS),
    cover: z.enum(COVER_IDS),
    translationSlug: z.string().optional(),
  }).transform((data) => ({ ...data, heading: data.title, title: data.title.replaceAll('­', '') })),
});

export const collections = { blog };
