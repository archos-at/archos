import { builtinModules } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

export const SIZE_BUDGET_BYTES = 4 * 1024 * 1024;
const PERMISSIVE = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NODE_BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function checkManifest(manifest, pkg) {
  for (const lib of manifest.libraries) {
    const pinned = pkg.devDependencies?.[lib.name] ?? pkg.dependencies?.[lib.name];
    if (pinned !== lib.version) {
      throw new Error(`${lib.name}: libraries.json says ${lib.version}, package.json pins ${pinned}.`);
    }
    const installed = await readJson(join(ROOT, "node_modules", lib.name, "package.json"));
    if (installed.version !== lib.version) {
      throw new Error(`${lib.name}: ${installed.version} is installed, ${lib.version} is pinned. Run bun install.`);
    }
    if (!PERMISSIVE.has(lib.license)) throw new Error(`${lib.name}: licence ${lib.license} is not admitted.`);
    const declared = String(installed.license ?? "");
    if (declared !== lib.license && !(lib.license_note && declared.includes(lib.license))) {
      throw new Error(`${lib.name}: the package declares ${declared}, the manifest ${lib.license}.`);
    }
  }
}

async function entrySource(name) {
  const spec = JSON.stringify(name);
  const probe = await esbuild.build({
    ...LIBRARY_OPTIONS,
    stdin: { contents: `export * from ${spec};`, resolveDir: ROOT, sourcefile: "probe.mjs" },
    minify: false,
    metafile: true,
  });
  const named = Object.values(probe.metafile.outputs)[0].exports.filter((key) => key !== "default");
  if (named.length > 0) {
    const hasDefault = await esbuild
      .build({ ...LIBRARY_OPTIONS, stdin: { contents: `export { default } from ${spec};`, resolveDir: ROOT, sourcefile: "probe.mjs" }, logLevel: "silent" })
      .then(() => true, () => false);
    const dflt = hasDefault ? `export { default } from ${spec};` : `import * as ns from ${spec};\nexport default ns;`;
    return `export * from ${spec};\n${dflt}\n`;
  }
  const ns = await import(name);
  const keys = Object.keys(ns.default ?? {}).filter((key) => IDENTIFIER.test(key) && key !== "default");
  const destructure = keys.length ? `export const { ${keys.join(", ")} } = m;\n` : "";
  return `import m from ${spec};\nexport default m;\n${destructure}`;
}

const nodeBuiltins = {
  name: "node-builtins",
  setup(build) {
    build.onResolve({ filter: /^[a-z_]+(\/[a-z_]+)?$|^node:/ }, (args) => {
      const bare = args.path.replace(/^node:/, "");
      if (!NODE_BUILTINS.has(bare)) return undefined;
      return { path: `node:${bare}`, external: true };
    });
  },
};

const LIBRARY_OPTIONS = {
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["worker", "browser", "import"],
  mainFields: ["browser", "module", "main"],
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  plugins: [nodeBuiltins],
  write: false,
  logLevel: "error",
};

async function buildLibrary(lib) {
  const result = await esbuild.build({
    stdin: { contents: await entrySource(lib.name), resolveDir: ROOT, sourcefile: `${lib.name}-entry.mjs` },
    ...LIBRARY_OPTIONS,
  });
  const code = result.outputFiles[0].text;
  const bytes = Buffer.byteLength(code);
  if (bytes > SIZE_BUDGET_BYTES) throw new Error(`${lib.name}: ${bytes} bytes is over the ${SIZE_BUDGET_BYTES} budget.`);
  await writeFile(join(DIST, "libs", `${lib.name}.mjs.txt`), code);
  return bytes;
}

async function buildWorker(libraries) {
  const imports = libraries.map((lib, i) => `import l${i} from "./libs/${lib.name}.mjs.txt";`);
  const map = libraries.map((lib, i) => `  ${JSON.stringify(lib.name)}: l${i},`);
  await writeFile(
    join(DIST, "libraries.gen.js"),
    `${imports.join("\n")}\nexport const LIBRARY_MODULES = {\n${map.join("\n")}\n};\n`,
  );
  await esbuild.build({
    entryPoints: [join(ROOT, "src", "worker.js")],
    outfile: join(DIST, "worker.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser", "import"],
    target: "es2022",
    external: ["cloudflare:*", "node:*"],
    loader: { ".txt": "text" },
    alias: { "#libraries": join(DIST, "libraries.gen.js") },
    logLevel: "error",
  });
}

const manifest = await readJson(join(ROOT, "libraries.json"));
await checkManifest(manifest, await readJson(join(ROOT, "package.json")));
await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, "libs"), { recursive: true });
const sizes = {};
for (const lib of manifest.libraries) sizes[lib.name] = await buildLibrary(lib);
await buildWorker(manifest.libraries);
await writeFile(join(DIST, "sizes.json"), `${JSON.stringify(sizes, null, 2)}\n`);
for (const [name, bytes] of Object.entries(sizes)) console.log(`${name.padEnd(18)} ${(bytes / 1024).toFixed(0).padStart(6)} KiB`);
