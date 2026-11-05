/**
 * The few REST calls the social scripts make to the CMS (Payload), over fetch,
 * with a robot's API key: `Authorization: users API-Key <key>`. Not Payload's
 * SDK: three verbs and a key do not need one, and the scripts run in a bare Node
 * next to the CMS rather than inside it.
 */

export class CmsError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} answered ${status}: ${body.slice(0, 500)}`);
    this.status = status;
  }
}

/** `where[status][equals]=approved&depth=2`: Payload's REST query string (the `qs` format) from plain objects. */
export function query(params) {
  const parts = [];
  const add = (key, value) => {
    if (value === undefined) return;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * @param {string} baseUrl  where the CMS answers, e.g. http://localhost:3100
 * @param {string} apiKey   a user's API key
 */
export function cms(baseUrl, apiKey, fetchImpl = fetch) {
  const root = `${baseUrl.replace(/\/+$/, '')}/api`;
  async function request(method, path, body) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: { Authorization: `users API-Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new CmsError(method, path, res.status, text);
    return text ? JSON.parse(text) : undefined;
  }
  return {
    /** Every document of a find, without paging. */
    find: async (collection, params = {}) => (await request('GET', `/${collection}${query({ ...params, limit: 0 })}`)).docs,
    create: async (collection, data) => (await request('POST', `/${collection}`, data)).doc,
    update: async (collection, id, data) => (await request('PATCH', `/${collection}/${id}`, data)).doc,
  };
}

/** The client for `CMS_URL` and the key in `keyVariable`; a missing variable fails with its name. */
export function cmsFromEnv(keyVariable, env = process.env) {
  const url = env.CMS_URL;
  const key = env[keyVariable];
  const missing = [url ? undefined : 'CMS_URL', key ? undefined : keyVariable].filter(Boolean);
  if (missing.length > 0) throw new Error(`Set ${missing.join(' and ')}.`);
  return cms(url, key);
}
