#!/usr/bin/env node
// Builds the KAIKATA extension: extension/ plus a copy of the web app under app/.
//
//   node scripts/package-extension.mjs [--out <dir>]
//
// → <out>/kaikata-extension/            (load unpacked in chrome://extensions)
// → <out>/kaikata-extension-<version>.zip (manifest.json at the root; share with friends)
//
// <out> defaults to dist/. The web app has no build step; only this copy is changed:
// index.html gets local Geist (extension pages allow no remote CSS) and loads
// ../cartforge-wants-flow.js for src/host.mjs. Node built-ins + the system `zip` CLI only.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_NAME = "kaikata-extension";
const APP_DIR = "app";
const APP_FILES = ["index.html", "styles.css", "shipping_data.json", "sample-cart-mobile.txt"];
const SKIPPED_NAMES = new Set([".DS_Store"]);

// "## 2.0.0", "## [2.0.0] — 2026-09-24", …
export function changelogHasVersion(changelog, version) {
  const escaped = String(version).replace(/[.]/g, "\\.");
  return new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`, "m").test(String(changelog || ""));
}

// The packaged page only: Google Fonts → bundled Geist, and the wants-flow helpers that
// src/host.mjs uses on the extension host (classic script, runs before the module).
export function transformIndexHtml(html) {
  const fontLines = /^[ \t]*<link[^>]+(fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\r?\n/gm;
  const found = html.match(fontLines) || [];
  if (!found.length) throw new Error("index.html: Google Fonts links not found; update transformIndexHtml.");
  let out = html.replace(fontLines, (line, _host, offset) => (
    offset === html.search(fontLines) ? '    <link rel="stylesheet" href="../app-assets/fonts.css">\n' : ""
  ));
  const moduleScript = /^([ \t]*)<script type="module"/m;
  if (!moduleScript.test(out)) throw new Error("index.html: module script not found; update transformIndexHtml.");
  out = out.replace(moduleScript, '$1<script src="../cartforge-wants-flow.js"></script>\n$1<script type="module"');
  return out;
}

async function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIPPED_NAMES.has(entry.name) || entry.name.endsWith(".bak")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full));
  }
  return files;
}

function zipAvailable() {
  const probe = spawnSync("zip", ["-v"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

export async function packageExtension({ root = DEFAULT_ROOT, outDir = path.join(root, "dist"), zip = true } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, "extension", "manifest.json"), "utf8"));
  const version = manifest.version;
  const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8").catch(() => "");
  if (!changelogHasVersion(changelog, version)) {
    throw new Error(`CHANGELOG.md has no entry for ${version} (extension/manifest.json). Add "## ${version}" first.`);
  }
  if (zip && !zipAvailable()) {
    throw new Error("The `zip` command was not found. Install it (macOS ships it; Debian/Ubuntu: apt install zip) or run with --no-zip.");
  }

  const buildDir = path.join(outDir, BUILD_NAME);
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  for (const file of await listFiles(path.join(root, "extension"))) {
    await mkdir(path.dirname(path.join(buildDir, file)), { recursive: true });
    await cp(path.join(root, "extension", file), path.join(buildDir, file));
  }

  const appDir = path.join(buildDir, APP_DIR);
  await mkdir(path.join(appDir, "src"), { recursive: true });
  for (const file of APP_FILES) {
    await cp(path.join(root, file), path.join(appDir, file));
  }
  for (const file of await listFiles(path.join(root, "src"))) {
    if (!file.endsWith(".mjs")) continue;
    await mkdir(path.dirname(path.join(appDir, "src", file)), { recursive: true });
    await cp(path.join(root, "src", file), path.join(appDir, "src", file));
  }
  const indexPath = path.join(appDir, "index.html");
  await writeFile(indexPath, transformIndexHtml(await readFile(indexPath, "utf8")));

  const files = (await listFiles(buildDir)).map((file) => file.split(path.sep).join("/")).sort();
  const result = { version, buildDir, files, zipPath: null, zipBytes: 0 };
  if (zip) {
    const zipPath = path.join(outDir, `${BUILD_NAME}-${version}.zip`);
    // zip adds to an existing archive, so start fresh.
    await rm(zipPath, { force: true });
    const run = spawnSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: buildDir, encoding: "utf8" });
    if (run.error || run.status !== 0) {
      throw new Error(`zip failed: ${run.error?.message || run.stderr || `exit ${run.status}`}`);
    }
    result.zipPath = zipPath;
    result.zipBytes = (await stat(zipPath)).size;
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") options.outDir = path.resolve(argv[++i]);
    else if (argv[i] === "--no-zip") options.zip = false;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await packageExtension(parseArgs(process.argv.slice(2)));
    console.log(`KAIKATA extension ${result.version}`);
    console.log(`  folder: ${path.relative(process.cwd(), result.buildDir) || "."} (${result.files.length} files)`);
    if (result.zipPath) {
      console.log(`  zip:    ${path.relative(process.cwd(), result.zipPath)} (${(result.zipBytes / 1024).toFixed(1)} KB)`);
    }
  } catch (error) {
    console.error(`package-extension: ${error.message}`);
    process.exit(1);
  }
}
