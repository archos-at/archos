import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `sending`: the hand-off's claim on an approved social post, written before the
 * post goes to Buffer (src/access/social.ts). Adding an enum value rewrites no
 * row, so every existing post keeps its status.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_social_posts_status" ADD VALUE 'sending' BEFORE 'scheduled';
  ALTER TYPE "public"."enum__social_posts_v_version_status" ADD VALUE 'sending' BEFORE 'scheduled';`)
}

/**
 * A post that is `sending` may or may not be at Buffer. It goes to `failed`,
 * which a person looks at, never back to `approved`, which would send it again.
 */
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "social_posts" SET "status" = 'failed', "publish_error" = 'Claimed by the hand-off when the sending status was removed. Check Buffer before sending it again.' WHERE "status" = 'sending';
  UPDATE "_social_posts_v" SET "version_status" = 'failed' WHERE "version_status" = 'sending';
  ALTER TABLE "social_posts" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "social_posts" ALTER COLUMN "status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_social_posts_status";
  CREATE TYPE "public"."enum_social_posts_status" AS ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'archived');
  ALTER TABLE "social_posts" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."enum_social_posts_status";
  ALTER TABLE "social_posts" ALTER COLUMN "status" SET DATA TYPE "public"."enum_social_posts_status" USING "status"::"public"."enum_social_posts_status";
  ALTER TABLE "_social_posts_v" ALTER COLUMN "version_status" SET DATA TYPE text;
  ALTER TABLE "_social_posts_v" ALTER COLUMN "version_status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum__social_posts_v_version_status";
  CREATE TYPE "public"."enum__social_posts_v_version_status" AS ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'archived');
  ALTER TABLE "_social_posts_v" ALTER COLUMN "version_status" SET DEFAULT 'draft'::"public"."enum__social_posts_v_version_status";
  ALTER TABLE "_social_posts_v" ALTER COLUMN "version_status" SET DATA TYPE "public"."enum__social_posts_v_version_status" USING "version_status"::"public"."enum__social_posts_v_version_status";`)
}
