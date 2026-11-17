import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig, type FieldAccess } from 'payload';
import { canUseAdminPanel, isAdmin, ROLES } from '../access/roles';
import { options } from '../fields/choices';
import { edgeSettings, edgeStrategy } from '../auth/edge';

const edge = edgeSettings();

export const MIN_PASSWORD_LENGTH = 12;

const adminOnly: FieldAccess = ({ req }) => isAdmin(req.user);
const adminOrFirstUser: FieldAccess = ({ req }) => !req.user || isAdmin(req.user);

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
    strategies: edge ? [edgeStrategy(edge)] : [],
    cookies: { sameSite: 'Strict', secure: (process.env.CMS_PUBLIC_URL ?? '').startsWith('https://') },
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
      access: { create: adminOrFirstUser, update: adminOnly },
      admin: { description: 'Editor drafts, Publisher publishes, Agent drafts through the API or MCP. Website and Social hand-off are robots with an API key.' },
    },
  ],
};
