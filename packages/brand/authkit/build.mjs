#!/usr/bin/env node
/**
 * Renders the AuthKit stylesheet WorkOS takes from authkit.css.
 *
 *   node packages/brand/authkit/build.mjs
 *     writes packages/brand/dist/authkit.css, the photo inlined as a data URI
 *   LOGIN_PHOTO_URL=https://piloti.at/media/login-photo.webp node packages/brand/authkit/build.mjs
 *     writes the same stylesheet pointing at the photo the website serves
 *     (apps/website/public/media/login-photo.webp), printed instead of written
 *
 * AuthKit's page allows images from any origin (img-src * data:), and the website
 * sends no Cross-Origin-Resource-Policy, so the hosted photo loads. The URL form
 * keeps the stylesheet at a few kilobytes, which the WorkOS connector can carry
 * whole; the inlined form is the one to paste when the website does not serve it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const photo = readFileSync(resolve(here, 'login-photo.webp')).toString('base64')
const url = process.env.LOGIN_PHOTO_URL
const css = readFileSync(resolve(here, 'authkit.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//, '')
  .replace("url('./login-photo.webp')", `url('${url ?? `data:image/webp;base64,${photo}`}')`)
  .trim()
if (url) {
  process.stdout.write(`${css}\n`)
} else {
  writeFileSync(resolve(here, '../dist/authkit.css'), `${css}\n`)
  console.log(`dist/authkit.css: ${css.length} bytes`)
}
