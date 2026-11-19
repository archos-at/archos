import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";

export const TYPST_COMPILER_FILE = "typst-compiler.wasm";
export const TYPST_FILES_FILE = "typst-files.bin";
const REGISTRY = "https://packages.typst.org/preview";
const ADMITTED = new Set(["MIT", "MIT-0", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "OFL-1.1"]);

function admitted(entry) {
  const alternatives = String(entry.license).split(" OR ");
  if (alternatives.some((licence) => ADMITTED.has(licence))) return true;
  return Boolean(entry.license_note);
}

async function installedVersion(root, name) {
  return JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8")).version;
}

async function checkPinned(root, pkg, name, version) {
  const pinned = pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];
  if (pinned !== version) throw new Error(`${name}: libraries.json says ${version}, package.json pins ${pinned}.`);
  const installed = await installedVersion(root, name);
  if (installed !== version) throw new Error(`${name}: ${installed} is installed, ${version} is pinned. Run bun install.`);
}

async function checkTypst(root, typst, pkg) {
  await checkPinned(root, pkg, typst.compiler.name, typst.compiler.version);
  for (const font of typst.fonts) await checkPinned(root, pkg, font.package, font.version);
  for (const entry of [typst.compiler, ...typst.fonts, ...typst.packages]) {
    if (!admitted(entry)) throw new Error(`${entry.name ?? entry.package}: licence ${entry.license} is not admitted.`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function typstPackage(root, entry) {
  const name = `${entry.name}-${entry.version}.tar.gz`;
  const cached = join(root, "node_modules", ".cache", "typst-packages", name);
  const hit = await readFile(cached).catch(() => null);
  if (hit && sha256(hit) === entry.sha256) return hit;
  const response = await fetch(`${REGISTRY}/${name}`);
  if (!response.ok) throw new Error(`${name}: the Typst registry answered ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== entry.sha256) throw new Error(`${name}: sha256 ${sha256(bytes)}, libraries.json pins ${entry.sha256}.`);
  await mkdir(join(root, "node_modules", ".cache", "typst-packages"), { recursive: true });
  await writeFile(cached, bytes);
  return bytes;
}

async function packFiles(root, typst) {
  const parts = [];
  let offset = 0;
  const place = (bytes) => {
    parts.push(bytes);
    const at = [offset, bytes.byteLength];
    offset += bytes.byteLength;
    return at;
  };
  const fonts = [];
  for (const font of typst.fonts) {
    for (const file of font.files) fonts.push(place(await readFile(join(root, "node_modules", font.package, file))));
  }
  const packages = {};
  for (const entry of typst.packages) packages[`${entry.name}:${entry.version}`] = place(await typstPackage(root, entry));
  return { blob: Buffer.concat(parts), fonts, packages };
}

const NO_CODEGEN = `function noCodegen(...parts) {
  const body = parts.at(-1);
  if (body === "return this") return () => globalThis;
  if (body === "return path") return (path) => path;
  const constant = /^return (-?\\d+|true|false|null)$/.exec(body);
  if (constant) return () => JSON.parse(constant[1]);
  const thrown = /^throw new Error\\('([^']*)'\\)$/.exec(body);
  if (thrown) return () => { throw new Error(thrown[1]); };
  throw new Error("The Typst compiler asked to generate code from a string: " + body.slice(0, 200));
}
`;

const withoutCodegen = {
  name: "typst-without-codegen",
  setup(build) {
    build.onLoad({ filter: /typst_ts_web_compiler\.mjs$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const patched = source.replaceAll("new Function(", "noCodegen(");
      if (patched === source) throw new Error("The Typst glue no longer calls new Function; review the patch.");
      return { contents: NO_CODEGEN + patched, loader: "js" };
    });
  },
};

export async function buildTypst(root, dist, typst, pkg, libraryOptions) {
  await checkTypst(root, typst, pkg);
  const { blob, fonts, packages } = await packFiles(root, typst);
  await writeFile(join(dist, TYPST_FILES_FILE), blob);
  const compiler = join(root, "node_modules", typst.compiler.name, "pkg", "typst_ts_web_compiler_bg.wasm");
  await copyFile(compiler, join(dist, TYPST_COMPILER_FILE));
  const index = join(dist, "typst-index.gen.js");
  await writeFile(index, `export const FONTS = ${JSON.stringify(fonts)};\nexport const PACKAGES = ${JSON.stringify(packages)};\n`);
  const result = await esbuild.build({
    ...libraryOptions,
    entryPoints: [join(root, "src", "typst.js")],
    external: [`./${TYPST_COMPILER_FILE}`, `./${TYPST_FILES_FILE}`],
    alias: { "#typst-index": index },
    plugins: [...libraryOptions.plugins, withoutCodegen],
  });
  const code = result.outputFiles[0].text;
  await writeFile(join(dist, "libs", `${typst.module}.mjs.txt`), code);
  return { library: Buffer.byteLength(code), compiler: (await readFile(compiler)).byteLength, files: blob.byteLength };
}
