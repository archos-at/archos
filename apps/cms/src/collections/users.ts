/**
 * The people and robots who sign in (ADR-0155). People sign in to the admin
 * panel with a password; robots (the website, the social hand-off, an agent's
 * account) use an API key: `Authorization: users API-Key <key>`.
 *
 * Payload's own sign-in, hardened until editors sign in through WorkOS (the
 * ADR's next slice; Payload's custom auth strategies take it without a plugin):
 * a long password, five attempts then a 15-minute lock, eight-hour sessions
 * that end on sign-out, and `SameSite=Strict` cookies, secure in production.
 * Nobody registers: an administrator creates every account.
 */
import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig, type FieldAccess } from 'payload';
import { canUseAdminPanel, isAdmin, ROLES } from '../access/roles';
import { options } from '../fields/choices';

export const MIN_PASSWORD_LENGTH = 12;

const adminOnly: FieldAccess = ({ req }) => isAdmin(req.user);
/**
 * Anonymous only on Payload's create-first-user screen: the collection's own
 * `create` admits administrators alone, so no other anonymous request gets here.
 */
const adminOrFirstUser: FieldAccess = ({ req }) => !req.user || isAdmin(req.user);

/** A password shorter than `MIN_PASSWORD_LENGTH` is refused; Payload checks none by itself. */
export const passwordPolicy: CollectionBeforeValidateHook = ({ data, req }) => {
  const password = (data as { password?: unknown } | undefined)?.password;
  if (typeof password === 'string' && password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError({
      collection: 'users',
      errors: [{ message: `At least ${MIN_PASSWORD_LENGTH} characters.`, path: 'password' }],
      req,
    });
  }
  return data;
};

/** The very first account (Payload's create-first-user screen) is the administrator. */
const firstUserIsAdmin: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
  if (operation !== 'create' || !data) return data;
  const { totalDocs } = await req.payload.count({ collection: 'users', overrideAccess: true, req });
  return totalDocs === 0 ? { ...data, role: 'admin' } : data;
};

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'], group: 'Settings' },
  auth: {
    useAPIKey: true,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    tokenExpiration: 8 * 60 * 60,
    useSessions: true,
    cookies: { sameSite: 'Strict', secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    admin: ({ req }) => canUseAdminPanel(req.user),
    create: ({ req }) => isAdmin(req.user),
    delete: ({ req }) => isAdmin(req.user),
    read: ({ req }) => (isAdmin(req.user) ? true : req.user ? { id: { equals: req.user.id } } : false),
    update: ({ req }) => (isAdmin(req.user) ? true : req.user ? { id: { equals: req.user.id } } : false),
    unlock: ({ req }) => isAdmin(req.user),
  },
  hooks: { beforeValidate: [firstUserIsAdmin, passwordPolicy] },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: options(ROLES),
      // Nobody grants themselves a role; an administrator grants it.
      access: { create: adminOrFirstUser, update: adminOnly },
      admin: { description: 'Editor drafts, Publisher publishes, Agent drafts through the API or MCP. Website and Social hand-off are robots with an API key.' },
    },
  ],
};
