import { Buffer } from "node:buffer";
import { LIMITS, WORKSPACE_ROOT } from "./limits.js";

export class BadRequest extends Error {}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const encoder = new TextEncoder();

export function isWorkspacePath(path) {
  if (typeof path !== "string" || !path.startsWith(`${WORKSPACE_ROOT}/`)) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  const segments = path.slice(1).split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parseFiles(files) {
  if (files === undefined) return [];
  if (!Array.isArray(files)) throw new BadRequest("files must be an array.");
  const seen = new Set();
  return files.map((file, index) => {
    if (file === null || typeof file !== "object") throw new BadRequest(`files[${index}] must be an object.`);
    if (!isWorkspacePath(file.path)) {
      throw new BadRequest(`files[${index}].path must be an absolute path under ${WORKSPACE_ROOT}/ without "..": ${JSON.stringify(file.path)}.`);
    }
    if (seen.has(file.path)) throw new BadRequest(`files[${index}].path ${file.path} appears twice.`);
    seen.add(file.path);
    if (typeof file.base64 !== "string" || !BASE64.test(file.base64) || file.base64.length % 4 === 1) {
      throw new BadRequest(`files[${index}].base64 must be standard base64.`);
    }
    return { path: file.path, bytes: new Uint8Array(Buffer.from(file.base64, "base64")) };
  });
}

function parseTimeout(timeoutMs) {
  if (timeoutMs === undefined) return LIMITS.defaultTimeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new BadRequest("timeoutMs must be a positive number.");
  }
  if (timeoutMs > LIMITS.maxTimeoutMs) throw new BadRequest(`timeoutMs cannot exceed ${LIMITS.maxTimeoutMs}.`);
  return Math.ceil(timeoutMs);
}

export function parseRunRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("The body must be a JSON object.");
  const { source, language = "js", input = null } = body;
  if (typeof source !== "string" || source.trim() === "") throw new BadRequest("source is required.");
  const sourceBytes = encoder.encode(source).byteLength;
  if (sourceBytes > LIMITS.maxSourceBytes) throw new BadRequest(`source is ${sourceBytes} bytes; the limit is ${LIMITS.maxSourceBytes}.`);
  if (language !== "js" && language !== "ts") throw new BadRequest('language must be "js" or "ts".');
  const files = parseFiles(body.files);
  const inputBytes = encoder.encode(JSON.stringify(input) ?? "null").byteLength;
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, sourceBytes + inputBytes);
  if (total > LIMITS.maxInputBytes) throw new BadRequest(`The request carries ${total} bytes; the limit is ${LIMITS.maxInputBytes}.`);
  return { source, language, input, files, timeoutMs: parseTimeout(body.timeoutMs) };
}
