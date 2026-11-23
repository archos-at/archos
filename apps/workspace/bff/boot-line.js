// @ts-check
// `bootLine` of `./boot.ts` in CommonJS for `server.js`, which has no build step; `tests/lib/boot.test.ts` pins the two.

/** @param {Record<string, string | undefined>} env */
function bootLogLine(env) {
  const sha = (env.GIT_SHA || '').trim() || 'unknown'
  const flags = (env.REQUIRE_AUTH || '').toLowerCase() === 'true' ? 'workos' : 'defaults'
  return `[boot] sha=${sha} flags=${flags}`
}

module.exports = { bootLogLine }
